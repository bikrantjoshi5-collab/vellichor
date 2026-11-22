/** @type {import('jest').Config} */
module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  roots: ['<rootDir>/tests'],
  moduleNameMapper: {
    '^@/(.*)$': '<rootDir>/src/$1'
  },
  transformIgnorePatterns: [
    'node_modules/(?!(?:.+/)?(?:htmlparser2|domhandler|domutils|dom-serializer|domelementtype|entities|cheerio|cheerio-select|css-select|css-what|nth-check|boolbase)/)'
  ],
  transform: {
    '^.+\\.[tj]sx?$': [
      'ts-jest',
      {
        tsconfig: {
          allowJs: true,
          module: 'commonjs',
          moduleResolution: 'node',
          esModuleInterop: true,
          strict: true,
          jsx: 'react-jsx'
        }
      }
    ]
  }
};
