import * as superagent from "superagent";
// @ts-ignore
import Throttle from "superagent-throttle";
import { initRequest } from "./utils";
import { Method } from "./types";

interface Conf {
  logger: boolean;
  rate: number;
  baseUrl: string;
  tokenUrl: string;
}

const defaultConf: Conf = {
  logger: false,
  rate: 2,
  baseUrl: "https://api.intra.42.fr/v2/",
  tokenUrl: "https://api.intra.42.fr/oauth/token",
};

export class FortyTwoProxy {
  private access_token: string | null;
  private throttler: any;
  private logger: boolean;
  private baseUrl: string;
  private tokenUrl: string;

  constructor(
    private clientId: string,
    private clientSecret: string,
    conf: Partial<Conf>
  ) {
    const config = { ...defaultConf, conf };

    this.baseUrl = config.baseUrl;
    this.tokenUrl = config.tokenUrl;
    this.access_token = null;
    this.logger = config.logger;
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

  private async reqHandler(method: Method, url: string, body?: any) {
    try {
      const res = await this.fetch(method, url, body);
      if (this.logger)
        console.log(`\x1b[42m${res.status}\x1b[0m ${method} ${url}`);
      return res.body;
    } catch (err: any) {
      // SuperTest error object has a 'status' and 'response'
      if (err && err.status) {
        console.log(`${method} ${url} \x1b[41m${err.status}\x1b[0m`);
      } else if (err && err.response && err.response.status) {
        console.log(err.response.status);
      } else {
        console.log("No status code available");
      }
      console.error(err);
      return null;
    }
  }

  // Public methods

  public async get(endpoint: string) {
    return this.reqHandler("GET", endpoint);
  }

  public async post(endpoint: string, body: any) {
    return this.reqHandler("POST", endpoint, body);
  }

  public async patch(endpoint: string, body: any) {
    return this.reqHandler("PATCH", endpoint, body);
  }

  public async delete(endpoint: string) {
    return this.reqHandler("DELETE", endpoint);
  }

  public async getAll(endpoint: string) {
    const all: any[] = [];
    let page = 1;
    let done = false;

    while (!done) {
      const url = new URL(this.baseUrl + endpoint);
      const params = new URLSearchParams(url.search);
      params.set("per_page", "100");
      params.set("page", page.toString());
      url.search = params.toString();

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
}
