const queue = [];

const log = (...args) => {
	queue.push(args);
};

console.log = (...args) => log("LOG", ...args);
console.warn = (...args) => log("WARN", ...args);
console.error = (...args) => log("ERROR", ...args);

export const getLogQueue = (log) => {
	console.log = (...args) => log("LOG", ...args);
	console.warn = (...args) => log("WARN", ...args);
	console.error = (...args) => log("ERROR", ...args);
	return queue;
};
