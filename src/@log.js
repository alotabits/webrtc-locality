const queue = [];

const log = (...args) => {
	queue.push(args);
};

console.log = log;

export const getLogQueue = (log) => {
	console.log = log;
	return queue;
};
