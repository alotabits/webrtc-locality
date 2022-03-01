const queue = [];

const log = (...args) => {
  queue.push(args);
};

const nativeLog = console.log;
const nativeWarn = console.warn;
const nativeError = console.error;

console.log = (...args) => {
  nativeLog(...args);
  log("LOG", ...args);
};

console.warn = (...args) => {
  nativeWarn(...args);
  log("WARN", ...args);
};

console.error = (...args) => {
  nativeError(...args);
  log("ERROR", ...args);
};

export const getLogQueue = (log) => {
  console.log = (...args) => {
    nativeLog(...args);
    log("LOG", ...args);
  };

  console.warn = (...args) => {
    nativeWarn(...args);
    log("WARN", ...args);
  };

  console.error = (...args) => {
    nativeError(...args);
    log("ERROR", ...args);
  };

  return queue;
};
