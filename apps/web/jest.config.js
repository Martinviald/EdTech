/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'jsdom',
  roots: ['<rootDir>/src'],
  testRegex: '.*\\.test\\.tsx?$',
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1',
    '^(react-markdown|remark-gfm)$': '<rootDir>/jest.esm-stub.js',
  },
  setupFiles: ['<rootDir>/jest.setup.js'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          isolatedModules: true,
          target: 'ES2022',
        },
      },
    ],
  },
};
