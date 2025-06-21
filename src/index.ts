import * as superagent from "superagent";
// @ts-ignore
import Throttle from "superagent-throttle";
import { initRequest } from "./utils";
import { Method } from "./types";

interface Conf {
  logs: boolean;
  errors: boolean;
  rate: number;
  baseUrl: string;
  tokenUrl: string;
}

const defaultConf: Conf = {
  logs: true,
  errors: true,
  rate: 2,
  baseUrl: "https://api.intra.42.fr/v2/",
  tokenUrl: "https://api.intra.42.fr/oauth/token",
};

export class FortyTwoProxy {
  private access_token: string | null;
  private throttler: any;
  private logs: boolean;
  private baseUrl: string;
  private tokenUrl: string;

  constructor(
    private clientId: string,
    private clientSecret: string,
    conf: Partial<Conf>
  ) {
    const config = { ...defaultConf, ...conf };

    this.baseUrl = config.baseUrl;
    this.tokenUrl = config.tokenUrl;
    this.access_token = null;
    this.logs = config.logs;
    this.throttler = new Throttle({
      rate: config.rate,
      ratePer: 1100,
      concurrent: config.rate - 1 > 0 ? config.rate - 1 : 1,
    });
  }

  private async generateToken() {
    const res = await superagent.post(this.tokenUrl).send({
      grant_type: "client_credentials",
      client_id: this.clientId,
      client_secret: this.clientSecret,
    });

    return res.body.access_token;
  }

  private async fetch(method: Method, url: string, body?: object) {
    const req = initRequest(method, url);

    // Make sure an access_token is available
    if (!this.access_token) {
      this.access_token = await this.generateToken();
    }
    // Attach access_token
    req.set("Authorization", `Bearer ${this.access_token}`);

    // Send body if any is provided
    if (body) req.send(body);

    // Throttle resquest based on rate limit
    req.use(this.throttler.plugin());
    return req;
  }

  private async reqHandler(
    method: Method,
    url: string,
    body: any = null,
    retry: number = 0
  ): Promise<any> {
    try {
      const res = await this.fetch(method, url, body);
      this.log(res.status, method, url, retry);
      return res.body;
    } catch (err: any) {
      // SuperTest error object has a 'status' and 'response'
      if (err && err.status) {
        this.log(err.status, method, url, retry);
        this.error(err.response.body)
        if (retry < 5 && (err.status === 429 || err.status === 401)) {
          return this.reqHandler(method, url, body, retry + 1);
        }
      }
      throw err;
    }
  }

  public log(status: number, method: string, url: string, retry: number = 0) {
    if (!this.logs) {
      return;
    }

    method = method.padEnd(6, " ");
    url = url.slice(this.baseUrl.length - 4);
    const color = status >= 200 && status < 400 ? "\x1b[42m" : "\x1b[41m";
    const reset = "\x1b[0m";

    const msg = `${color}${status}${reset} ${method} ${url}${
      retry ? ` (retry ${retry})` : ``
    }`;
    console.log(msg);
  }

  public error(err: any) {
    if (!this.logs) {
      return;
    }
    console.error(err);
  }

  // Public methods

  public async get(endpoint: URL | string) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.baseUrl);
    }
    return this.reqHandler("GET", endpoint.toString());
  }

  public async post(endpoint: URL | string, body: any) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.baseUrl);
    }
    return this.reqHandler("POST", endpoint.toString(), body);
  }

  public async patch(endpoint: URL | string, body: any) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.baseUrl);
    }
    return this.reqHandler("PATCH", endpoint.toString(), body);
  }

  public async delete(endpoint: URL | string, body: any) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.baseUrl);
    }
    return this.reqHandler("DELETE", endpoint.toString(), body);
  }

  public async getAll(endpoint: URL | string, perPage: number = 100) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.baseUrl);
    }

    const all: any[] = [];
    let page = 1;
    let done = false;

    while (!done) {
      const url = new URL(endpoint);
      url.searchParams.append("per_page", perPage.toString());
      url.searchParams.append("page", page.toString());

      const items = await this.reqHandler("GET", url.toString());

      if (!Array.isArray(items)) {
        return items;
      }
      all.push(...items);

      if (items.length < 100) {
        done = true;
      } else {
        page += 1;
      }
    }

    return all;
  }

  public URL(endpoint: string) {
    return new URL(endpoint, this.baseUrl);
  }
}
