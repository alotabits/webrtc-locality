import { StrictMode } from "react";
import ReactDOM from "react-dom";
// @ to make it sort first;
import { getLogQueue } from "./@log";
import App from "./App";

const query = new URLSearchParams(document.location.search);
const rootElement = document.getElementById("root");

ReactDOM.render(
  <StrictMode>
    <App getLogQueue={getLogQueue} query={query} version={3} />
  </StrictMode>,
  rootElement
);
