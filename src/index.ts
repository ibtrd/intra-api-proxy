import * as superagent from "superagent";
// @ts-ignore
import Throttle from "superagent-throttle";
import { getLastPage, initRequest } from "./utils";
import { inputOptions, perPage, reqOptions } from "./types";
import { isSuperAgentError, simplifySuperagentError } from "./HttpError";

export interface FortytwoIntraClientConf {
  redirect_uri: string | null;
  base_url: string;
  token_url: string;
  oauth_url: string;
  token_info_url: string;
  scopes: string[];
  rate: number;
  maxRetry: number;
  logs: boolean;
  errors: boolean;
}

const defaultConf: FortytwoIntraClientConf = {
  redirect_uri: null,
  base_url: "https://api.intra.42.fr/v2/",
  token_url: "https://api.intra.42.fr/oauth/token",
  oauth_url: "https://api.intra.42.fr/oauth/authorize",
  token_info_url: "https://api.intra.42.fr/oauth/token/info",
  scopes: ["public"],
  rate: 2,
  maxRetry: 5,
  logs: true,
  errors: true,
};

export class FortytwoIntraClient {
  private redirect_uri: string | null;
  private base_url: string;
  private token_url: string;
  private oauth_url: string;
  private token_info_url: string;
  private scopes: string[];
  private throttler: any;
  private retryOn: number[];
  private maxRetry: number;
  private logs: boolean;

  private access_token: string | null;

  constructor(
    private client_id: string,
    private client_secret: string,
    conf: Partial<FortytwoIntraClientConf>
  ) {
    const config: FortytwoIntraClientConf = { ...defaultConf, ...conf };

    this.redirect_uri = config.redirect_uri;
    this.base_url = config.base_url;
    this.token_url = config.token_url;
    this.oauth_url = config.oauth_url;
    this.token_info_url = config.token_info_url;
    this.scopes = config.scopes;
    this.throttler = new Throttle({
      rate: config.rate,
      ratePer: 1100,
      concurrent: config.rate - 1 > 0 ? config.rate - 1 : 1,
    });
    this.retryOn = [401, 429, 500];
    this.maxRetry = config.maxRetry;
    this.logs = config.logs;

    this.access_token = null;
  }

  private async generateToken() {
    const res = await superagent.post(this.token_url).send({
      grant_type: "client_credentials",
      client_id: this.client_id,
      client_secret: this.client_secret,
      scope: this.scopes.join(" "),
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
      this.logSuccess(res, options);
      return res;
    } catch (err: any) {
      if (isSuperAgentError(err)) {
        const { attempt, maxRetry } = options;

        this.logError(err, url, options);
        if (
          maxRetry > 0 &&
          attempt < maxRetry &&
          this.retryOn.includes(err.status)
        ) {
          if (err.status === 401) {
            this.access_token = null;
          }
          options.attempt++;
          return this.reqHandler(url, options);
        } else {
          throw simplifySuperagentError(err);
        }
      } else {
        throw err;
      }
    }
  }

  private logSuccess(res: superagent.Response, options: reqOptions) {
    const method = options.method.padEnd(6, " ");
    const color = "\x1b[42m";
    const reset = "\x1b[0m";

    const msg = `${color + res.status + reset} ${method} ${res.request.url}${
      options.attempt ? ` retry ${options.attempt}/${options.maxRetry}` : ``
    }`;
    console.log(msg);
  }

  private logError(
    err: superagent.HTTPError & { response: superagent.Response },
    url: URL,
    options: reqOptions
  ) {
    const method = options.method.padEnd(6, " ");
    const color = "\x1b[41m";
    const reset = "\x1b[0m";

    const msg = `${color + err.status + reset} ${method} ${
      err.response.request.url
    }${options.attempt ? ` retry ${options.attempt}/${options.maxRetry}` : ``}`;
    console.log(msg, JSON.stringify(err.response.body, null, 2));
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

    const perPage = options.perPage || 100;

    let url = new URL(endpoint);
    const initialRes = await this.reqHandler(url, {
      method: "GET",
      attempt: 0,
      maxRetry: this.maxRetry,
      ...options,
      query: {
        page: 1,
        per_page: 100,
      },
    });

    let lastPage: number;
    try {
      lastPage = getLastPage(initialRes.header["link"]);
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
      return initialRes.body.concat(...values.map((value) => value.body));
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
    url.searchParams.set("scope", this.scopes.join(" "));

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

  public async tokenInfos() {
    return this.get(this.token_info_url);
  }
}
