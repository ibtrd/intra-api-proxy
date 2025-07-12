import * as superagent from "superagent";
import { Method } from "./types";

export function initRequest(method: Method, url: URL) {
  switch (method) {
    case "GET":
      return superagent.get(url.toString());
    case "POST":
      return superagent.post(url.toString());
    case "PATCH":
      return superagent.patch(url.toString());
    case "DELETE":
      return superagent.delete(url.toString());
    default:
      throw Error("Invalid HTTP method");
  }
}