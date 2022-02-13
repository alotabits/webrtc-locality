import { StrictMode } from "react";
import ReactDOM from "react-dom";
// @ to make it sort first;
import { getLogQueue } from "./@log";
import App from "./App";

const rootElement = document.getElementById("root");
ReactDOM.render(
	<StrictMode>
		<App getLogQueue={getLogQueue} />
	</StrictMode>,
	rootElement
);
