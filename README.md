HTTP Toolkit Desktop [![Build Status](https://github.com/httptoolkit/httptoolkit-desktop/workflows/CI/badge.svg)](https://github.com/httptoolkit/httptoolkit-desktop/actions)
===================

This repo contains the desktop build setup for [HTTP Toolkit](https://httptoolkit.tech), a beautiful, cross-platform & open-source HTTP(S) debugging proxy, analyzer & client.

Looking to file bugs, request features or send feedback? File an issue or vote on existing ones at [github.com/httptoolkit/httptoolkit](https://github.com/httptoolkit/httptoolkit).

## What is this?

This repo is responsible for building HTTP Toolkit into standalone desktop installers & executables that users can run directly on Windows, Linux & Mac.

HTTP Toolkit consists of two runtime parts: [a UI](https://github.com/httptoolkit/httptoolkit-ui), written as a single-page web application, and [a server](https://github.com/httptoolkit/httptoolkit-server), written as a node.js CLI application.

This repo builds a single executable that:

* Includes the latest build of [httptoolkit-server](https://github.com/httptoolkit/httptoolkit-server)
* When run:
    * Starts the server in the background
    * Opens the UI in an [Electron](https://electronjs.org/) window
    * Kills the server when closed

This means this is mostly Electron configuration & setup, and build configuration for the executable and various installers. It's built using [Electron Builder](https://electron.build/).

This isn't the only way to run HTTP Toolkit! It's the most convenient option for most users, but it's also completely possible to run the server as a standalone tool and open the UI (hosted at https://app.httptoolkit.tech) in any browser you'd like.

Note that the resulting executable _doesn't_ autoupdate (at the moment). Instead both the server (as an [oclif](http://oclif.io) app) and the web UI (via service workers) include their own auto-update functionality.

The builds themselves are done on GitHub Actions, and tagged `main` builds are automatically published from there as [github releases](https://github.com/httptoolkit/httptoolkit-desktop/releases).

## Contributing

If you want to change the behaviour of the HTTP Toolkit desktop shell (but not its contents), change how it's built, or add a new target platform or format, then you're in the right place :+1:.

To get started:

* Clone this repo.
* `npm install`
* To build & run the electron app locally:
    * `npm start` - runs the desktop app, downloading the latest live server & using the live UI from `app.httptoolkit.tech`.
        * This is useful if you're working on just the desktop app, and want to see your changes with the real live environment.
    * `npm run start:dev` - runs the desktop app, with no built-in server using the UI from `localhost:8080`
        * This effectively assumes you're bringing your own working UI & server, and is useful for working on this.
        * You can start both from the [UI project](https://github.com/httptoolkit/httptoolkit-ui) with just `npm start`, to work on the UI within the desktop app.
        * Alternatively, you can run `npm start` in the [server project](https://github.com/httptoolkit/httptoolkit-server), and `npm run start:web` in the UI project, to work on the server or both.
* To build distributable packages:
    * `npm run build` - this will attempt to build & package the desktop app for your current platform

A few tips:

* Electron dev behaviour isn't identical to production build behaviour, make sure you check your changes in a real built version.
* Most distributable build configuration is in under the `build` field in [`package.json`](./package.json).
 * To fully build packages, you may find some platforms complain about that signing certificates are required. You'll probably need to unset fields like `forceCodeSigning` to disable that.
* In CI, pull requests don't receive secret environment variables, so builds may fail. Confirm that that's what's happening, and if so that's ok - the team will manually build & evaluate PR changes to resolve this.

## License

The HTTP Toolkit desktop application source code is licensed under AGPL-3.0, [as documented in this repo](/LICENSE).

The binary downloads available in this repo or from [httptoolkit.tech](https://httptoolkit.tech) however may be used under one of two licenses: 

* [AGPL-3.0](/LICENSE), for those who want to modify and redistribute them, within the constraints of that license.
* [Creative Commons Attribution-NoDerivatives 4.0 International License](https://creativecommons.org/licenses/by-nd/4.0/) for those who don't need those rights and want to avoid any concerns about AGPL licensing.
