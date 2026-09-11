require("./main.cjs").start({
  projectRoot: require("node:path").resolve(__dirname, ".."),
  nodeExecutable: process.env.ARY_DESKTOP_NODE,
});
