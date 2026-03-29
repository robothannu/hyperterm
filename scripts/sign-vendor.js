const { execSync } = require("child_process");
const path = require("path");
const fs = require("fs");

exports.default = async function (context) {
  if (process.platform !== "darwin") return;

  const appPath = path.join(
    context.appOutDir,
    `${context.packager.appInfo.productFilename}.app`
  );
  const vendorDir = path.join(
    appPath,
    "Contents/Resources/app.asar.unpacked/vendor"
  );

  if (!fs.existsSync(vendorDir)) return;

  const files = [];
  for (const sub of ["lib", "bin"]) {
    const dir = path.join(vendorDir, sub);
    if (!fs.existsSync(dir)) continue;
    for (const f of fs.readdirSync(dir)) {
      files.push(path.join(dir, f));
    }
  }

  for (const file of files) {
    const stat = fs.statSync(file);
    if (!stat.isFile()) continue;
    console.log(`  • signing vendor binary: ${path.basename(file)}`);
    execSync(`codesign --force --sign - "${file}"`);
  }
};
