export type Method = "GET" | "POST" | "PATCH" | "DELETE";

export type userToken = {};

export type reqOptions = {
  method: Method;
  maxRetry: number;
  attempt: number;
  body?: any;
  token?: userToken;
};

export type perPage = { perPage?: number };

type internal = "method" | "attempt";
type optional = "maxRetry";

export type inputOptions = Omit<reqOptions, internal | optional> &
  Partial<Pick<reqOptions, optional>>;
