import { StrictMode } from "react";
import ReactDOM from "react-dom";
// @ to make it sort first;
import { getLogQueue } from "./@log";
import App from "./App";

const query = new URLSearchParams(document.location.hash);
const rootElement = document.getElementById("root");

ReactDOM.render(
	<StrictMode>
		<App getLogQueue={getLogQueue} query={query} version={1} />
	</StrictMode>,
	rootElement
);
