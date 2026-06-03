const app = require("../src/app");

module.exports = (req, res) => {
  req.url = req.url.replace(/^\/api/, "") || "/";
  return app(req, res);
};
