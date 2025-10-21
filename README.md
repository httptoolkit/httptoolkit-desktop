HTTP Toolkit Desktop [![Build Status](https://github.com/httptoolkit/httptoolkit-desktop/workflows/CI/badge.svg)](https://github.com/httptoolkit/httptoolkit-desktop/actions)
===================

This repo contains the desktop build setup for [HTTP Toolkit](https://httptoolkit.com), a beautiful, cross-platform & open-source HTTP(S) debugging proxy, analyzer & client.

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

Please see [CONTRIBUTING.md](CONTRIBUTING.md) for details on how to get started contributing to this repo.

## License

The HTTP Toolkit desktop application source code is licensed under AGPL-3.0, [as documented in this repo](/LICENSE).

The binary downloads available in this repo or from [httptoolkit.com](https://httptoolkit.com) however may be used under one of two licenses:

* [AGPL-3.0](/LICENSE), for those who want to modify and redistribute them, within the constraints of that license.
* [Creative Commons Attribution-NoDerivatives 4.0 International License](https://creativecommons.org/licenses/by-nd/4.0/) for those who don't need those rights and want to avoid any concerns about AGPL licensing.
