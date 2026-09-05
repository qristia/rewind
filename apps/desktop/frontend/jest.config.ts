/* eslint-disable */
export default {
  displayName: "frontend",
  preset: "../../../jest.preset.js",
  globals: {
    "ts-jest": {
      tsconfig: "<rootDir>/tsconfig.spec.json",
      isolatedModules: true,
    },
  },
  transform: {
    "^.+.[tj]sx?$": "ts-jest",
  },
  moduleFileExtensions: ["ts", "tsx", "js", "jsx"],
  moduleNameMapper: {
    "^@osujs/core$": "<rootDir>/../../../libs/osu/core/src/index.ts",
    "^@osujs/math$": "<rootDir>/../../../libs/osu/math/src/index.ts",
  },
  coverageDirectory: "../../../coverage/apps/frontend",
};
