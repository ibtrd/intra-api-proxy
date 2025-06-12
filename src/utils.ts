import * as superagent from "superagent";
import { Method } from "./types";

export function initRequest(method: Method, url: string) {
  switch (method) {
    case "GET":
      return superagent.get(url);
    case "POST":
      return superagent.post(url);
    case "PATCH":
      return superagent.patch(url);
    case "DELETE":
      return superagent.delete(url);
    default:
      throw Error("Invalid HTTP method");
  }
}
