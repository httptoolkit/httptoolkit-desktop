HTTP Toolkit Desktop [![Travis Build Status](https://img.shields.io/travis/httptoolkit/httptoolkit-desktop.svg)](https://travis-ci.org/httptoolkit/httptoolkit-desktop) [![Appveyor Build Status](https://ci.appveyor.com/api/projects/status/sfumuw6lm6qdpx7y?svg=true)](https://ci.appveyor.com/project/pimterry/httptoolkit-desktop)
===================

This repo contains the desktop build setup for [HTTP Toolkit](https://httptoolkit.tech), a beautiful, cross-platform & open-source HTTP(S) debugging proxy, analyzer & client.

Looking to file bugs, request features or send feedback? File an issue or vote on existing ones at [github.com/httptoolkit/feedback](https://github.com/httptoolkit/feedback).

## What is this?

This repo is responsible for building HTTP Toolkit into standalone desktop installers & executables that users can run directly on Windows, Linux & Mac.

HTTP Toolkit consists of two runtime parts: [a UI](https://github.com/httptoolkit/httptoolkit-ui), written as a single-page web application, and [a server](https://github.com/httptoolkit/httptoolkit-server), written as a node.js CLI application.

This repo builds a single executable that:

* Includes the latest build of [httptoolkit-server](https://github.com/httptoolkit/httptoolkit-server)
* When run:
    * Starts the server in the background
    * Opens the UI in an [Electron](https://electronjs.org/) window
    * Kills the server when closed

This means this is mostly Electron configuration & setup, and build configuration for the executable and various installers. It's built using [Electron Forge](https://docs.electronforge.io/).

This isn't the only way to run HTTP Toolkit! It's the most convenient option for most users, but it's also completely possible to run the server as a standalone tool and open the UI (hosted at https://app.httptoolkit.tech) in any browser you'd like.

Note that the resulting executable _doesn't_ autoupdate (at the moment). Instead both the server (as an [oclif](http://oclif.io) app) and the web UI (via service workers) include their own auto-update functionality.

The builds themselves are done on Travis (for Linux & OSX) and Appveyor (for Windows), and tagged master builds are automatically published from there, as [github releases](https://github.com/httptoolkit/httptoolkit-desktop/releases).

## Contributing

If you want to change the behaviour of the HTTP Toolkit desktop shell (but not its contents), change how it's built, or add a new target platform or format, then you're in the right place :+1:.

To get started:

* Clone this repo.
* `npm install`
* To build & run the electron app locally:
    * `npm start` - runs the desktop app, downloading the latest server & using the UI from `app.httptoolkit.tech`.
    * `npm run start:dev` - runs the desktop app, but using the UI from `localhost:8080` (i.e. assuming you're running your own UI).
* To build distributable packages:
    * `npm run make` - this will attempt to build & package the desktop app for your current platform

A few tips:

* Electron dev behaviour isn't identical to production build behaviour, make sure you check your changes in a real built version.
* Most distributable build configuration is in [`electron-forge.config.js`](./electron-forge.config.js)
* To build packages, you may find some platforms complain about that signing certificates are required, you'll probably need to delete keys (e.g. `osxSign` or `certificateFile`) to disable that.
* In CI, pull requests don't receive secret environment variables, so will likely fail. Confirm that that's what's happening, and if so that's ok - the team will manually build & evaluate PR changes to resolve this.
