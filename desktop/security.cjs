const path = require("node:path");
exports.allowedSender = (url) => {
  try {
    const u = new URL(url);
    return (
      u.protocol === "mfaro:" && u.host === "app" && u.pathname === "/offline/"
    );
  } catch {
    return false;
  }
};
exports.allowedExternal = (url) => {
  try {
    const u = new URL(url);
    return (
      u.origin === "https://mfaro-invoice.vercel.app" &&
      !u.username &&
      !u.password &&
      url.length < 2048
    );
  } catch {
    return false;
  }
};
exports.assetPath = (url, root) => {
  try {
    const u = new URL(url);
    if (u.protocol !== "mfaro:" || u.host !== "app") return null;
    const name = decodeURIComponent(u.pathname);
    if (name.includes("\\") || name.includes("\0")) return null;
    const allowed =
      name === "/offline/" ||
      name === "/offline/workspace.js" ||
      name === "/offline/workspace.css" ||
      name === "/MfaroInvoice-logo.svg" ||
      /^\/icons\/[a-z0-9-]+\.png$/.test(name);
    if (!allowed) return null;
    const target = path.resolve(
      root,
      "." + (name === "/offline/" ? "/offline/index.html" : name),
    );
    return target.startsWith(path.resolve(root) + path.sep) ? target : null;
  } catch {
    return null;
  }
};
