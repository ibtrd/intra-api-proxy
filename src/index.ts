import * as superagent from "superagent";
// @ts-ignore
import Throttle from "superagent-throttle";
import { getLastPage, initRequest } from "./utils";
import { inputOptions, perPage, reqOptions } from "./types";

interface Conf {
  redirect_uri: string | null;
  base_url: string;
  token_url: string;
  oauth_url: string;
  scope: string[];
  rate: number;
  maxRetry: number;
  logs: boolean;
  errors: boolean;
}

const defaultConf: Conf = {
  redirect_uri: null,
  base_url: "https://api.intra.42.fr/v2/",
  token_url: "https://api.intra.42.fr/oauth/token",
  oauth_url: "https://api.intra.42.fr/oauth/authorize",
  scope: ["public"],
  rate: 2,
  maxRetry: 5,
  logs: true,
  errors: true,
};

export class IntraApiProxy {
  private redirect_uri: string | null;
  private base_url: string;
  private token_url: string;
  private oauth_url: string;
  private scope: string[];
  private throttler: any;
  private maxRetry: number;
  private logs: boolean;

  private access_token: string | null;

  constructor(
    private client_id: string,
    private client_secret: string,
    conf: Partial<Conf>
  ) {
    const config: Conf = { ...defaultConf, ...conf };

    this.redirect_uri = config.redirect_uri;
    this.base_url = config.base_url;
    this.token_url = config.token_url;
    this.oauth_url = config.oauth_url;
    this.scope = config.scope;
    this.throttler = new Throttle({
      rate: config.rate,
      ratePer: 1100,
      concurrent: config.rate - 1 > 0 ? config.rate - 1 : 1,
    });
    this.maxRetry = config.maxRetry;
    this.logs = config.logs;

    this.access_token = null;
  }

  private async generateToken() {
    const res = await superagent.post(this.token_url).send({
      grant_type: "client_credentials",
      client_id: this.client_id,
      client_secret: this.client_secret,
      scope: this.scope.join(" "),
    });

    return res.body.access_token;
  }

  private async fetch(url: URL, options: reqOptions) {
    const { method, body } = options;
    const req = initRequest(method, url);

    if (!options.token && !this.access_token) {
      this.access_token = await this.generateToken();
    }

    // Attach access_token
    const accessToken = options.token
      ? options.token.access_token
      : this.access_token;
    req.set("Authorization", `Bearer ${accessToken}`);

    // Add query string
    if (options.query) req.query(options.query);
    // Send body if any is provided
    if (body) req.send(body);

    // Throttle resquest based on rate limit
    req.use(this.throttler.plugin());
    return req;
  }

  private async reqHandler(url: URL, options: reqOptions): Promise<any> {
    try {
      const res = await this.fetch(url, options);
      this.log(res.status, url, options);
      return res;
    } catch (err: any) {
      if (err && err.status) {
        const { attempt, maxRetry } = options;

        this.log(err.status, url, options);
        this.error(err.response.body);
        if (
          maxRetry > 0 &&
          attempt < maxRetry &&
          (err.status === 429 || err.status === 401)
        ) {
          if (err.status === 401) {
            this.access_token = null;
          }
          options.attempt++;
          return this.reqHandler(url, options);
        }
      }
      throw err;
    }
  }

  public log(status: number, url: URL, options: reqOptions) {
    if (!this.logs) {
      return;
    }

    const method = options.method.padEnd(6, " ");
    const color = status >= 200 && status < 400 ? "\x1b[42m" : "\x1b[41m";
    const reset = "\x1b[0m";

    const msg = `${color}${status}${reset} ${method} ${url}${
      options.attempt ? ` retry ${options.attempt}/${options.maxRetry}` : ``
    }`;
    console.log(msg);
  }

  public error(err: any) {
    if (!this.logs || Object.keys(err).length === 0) {
      return;
    }
    console.error(err);
  }

  // Public methods
  public async get(
    endpoint: URL | string,
    options: Omit<inputOptions, "body"> = {}
  ) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.base_url);
    }

     const res = await this.reqHandler(endpoint, {
      method: "GET",
      attempt: 0,
      maxRetry: this.maxRetry,
      ...options,
    });

    return res.body;
  }

  public async post(endpoint: URL | string, options: inputOptions = {}) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.base_url);
    }
    const res = await this.reqHandler(endpoint, {
      method: "POST",
      attempt: 0,
      maxRetry: this.maxRetry,
      ...options,
    });

    return res.body;
  }

  public async patch(endpoint: URL | string, options: inputOptions) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.base_url);
    }
    const res = await this.reqHandler(endpoint, {
      method: "PATCH",
      attempt: 0,
      maxRetry: this.maxRetry,
      ...options,
    });

    return res.body;
  }

  public async delete(endpoint: URL | string, options: inputOptions) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.base_url);
    }
    const res = await this.reqHandler(endpoint, {
      method: "DELETE",
      attempt: 0,
      maxRetry: this.maxRetry,
      ...options,
    });

    return res.body;
  }

  public async getAll(
    endpoint: URL | string,
    options: inputOptions & perPage = {}
  ) {
    if (endpoint instanceof URL === false) {
      endpoint = new URL(endpoint, this.base_url);
    }

    const all: any[] = [];
    const perPage = options.perPage || 100;

    let url = new URL(endpoint);
    url.searchParams.append("per_page", perPage.toString());
    url.searchParams.append("page", "1");

    const initialRes = await this.reqHandler(url, {
      method: "GET",
      attempt: 0,
      maxRetry: this.maxRetry,
      ...options,
    });

    let lastPage: number;
    try {
      lastPage = getLastPage(initialRes.header['link']);
    } catch (err) {
      return initialRes.body;
    }

    const promises = [];
    for (let i = 2; i <= lastPage; i++) {
      url = new URL(endpoint);
      url.searchParams.append("per_page", perPage.toString());
      url.searchParams.append("page", i.toString());

      promises.push(
        this.reqHandler(url, {
          method: "GET",
          attempt: 0,
          maxRetry: this.maxRetry,
          ...options,
        })
      );
    }

    return Promise.all(promises).then((values) => {
      return initialRes.body.concat(...values.map(value => value.body));
    });
  }

  public URL(endpoint: string) {
    return new URL(endpoint, this.base_url);
  }

  public getOAuthUrl(redirect_uri: string | null = null) {
    redirect_uri ??= this.redirect_uri;
    if (!redirect_uri) {
      throw new Error(`undefined redirect_uri`);
    }

    const url = new URL(this.oauth_url);
    url.searchParams.set("client_id", this.client_id);
    url.searchParams.set("redirect_uri", redirect_uri);
    url.searchParams.set("response_type", "code");
    url.searchParams.set("scope", this.scope.join(" "));

    return url.toString();
  }

  public async exchangeOAuthCode(code: string, redirect_uri?: string) {
    const res = await superagent.post(this.token_url).send({
      grant_type: "authorization_code",
      client_id: this.client_id,
      client_secret: this.client_secret,
      redirect_uri: redirect_uri ? redirect_uri : this.redirect_uri,
      code: code,
    });

    return res.body;
  }
}
