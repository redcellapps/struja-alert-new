// Windows only: ninja/CMake fail when native build paths exceed 260 characters, and the
// autolinked codegen dirs embed the full source path. Move the CMake staging dir to a short
// root. No-op on macOS/Linux/EAS. Override the location with STRUJA_CXX_DIR.
const { withAppBuildGradle } = require('expo/config-plugins');

const MARKER = '// struja: short cxx dir';

module.exports = function withShortCxxDir(config) {
  if (process.platform !== 'win32') return config;
  const dir = (process.env.STRUJA_CXX_DIR ?? 'C:/b').replaceAll('\\', '/');
  return withAppBuildGradle(config, (cfg) => {
    if (!cfg.modResults.contents.includes(MARKER)) {
      cfg.modResults.contents += `\n${MARKER}\nandroid {\n    externalNativeBuild {\n        cmake {\n            buildStagingDirectory = file("${dir}")\n        }\n    }\n}\n`;
    }
    return cfg;
  });
};
