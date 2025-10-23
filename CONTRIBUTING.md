# Contributing to HTTP Toolkit Desktop

Thanks for helping improve HTTP Toolkit. This document explains the quickest way to get started working on the desktop shell and how to contribute changes.

Prerequisites

- Node: >= 22 (this repo targets Node 22.x). We recommend using nvm to manage Node versions.
- To use the pinned version (if you have nvm installed):
  - nvm install # installs the version in .nvmrc
  - nvm use
- Or use your system Node if it meets the minimum version requirement.

To get started

- Clone this repo.
- Install dependencies: `npm install`
- To build & run the electron app locally:
  - `npm start` - runs the desktop app, downloading the latest live server & using the live UI from `app.httptoolkit.tech`.
    - Useful when working on just the desktop app and you want to test against the real live environment.
  - `npm run start:dev` - runs the desktop app with no built-in server, using the UI from `http://localhost:8080`.
    - Useful when you're running a local UI and/or server and want the desktop shell to host that UI.
    - To work on the UI and see it inside the desktop app, start the UI project (https://github.com/httptoolkit/httptoolkit-ui) with `npm start`.
    - Alternatively, run the server project (https://github.com/httptoolkit/httptoolkit-server) with `npm start`, and `npm run start:web` in the UI project to run server + UI locally.
- To build distributable packages:
  - `npm run build` - builds & packages the desktop app for your current platform.

A few tips

- Electron dev behaviour isn't identical to production build behaviour — verify changes in a real built version too.
- Most distributable build configuration lives in the `build` field of `package.json`.

Reporting issues

- For bugs or feature requests related to HTTP Toolkit itself, prefer filing issues at the main repo: https://github.com/httptoolkit/httptoolkit/
- For issues specific to this desktop shell (packaging, Electron behaviour, installers), open an issue in this repo.

Making changes & pull requests

- Create a feature branch from main for each change.
- Keep PRs focused and include a clear description of the problem and your solution.
- Ensure the TypeScript compiles: `npm run build:src`
- If your change affects packaging or build steps, include instructions to reproduce locally.
- CI must pass before merging; maintainers will review and merge.

Coding style & tests

- This project is TypeScript. Follow existing code patterns and style.
- Run the TypeScript compiler to check for errors: `npm run build:src`
