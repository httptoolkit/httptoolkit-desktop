/*
    This file defines the full configuration for electron forge and each of the
    packaging tools it configures. It's referenced by config.forge in package.json.

    It also makes this configuration dynamic, using env vars to configure
    secrets from CI without having to hardcode them. In theory it should be possible
    to dynamically configure electron forge with secrets using ELECTRON_FORGE_*
    variables, but this doesn't seem to work (see
    https://github.com/electron-userland/electron-forge/issues/657) so
    we have to do this instead.
*/

const path = require('path');
const {
    ELECTRON_FORGE_ELECTRON_WINSTALLER_CONFIG_CERTIFICATE_PASSWORD
} = process.env;

module.exports = {
    "make_targets": {
        "win32": [
            "squirrel",
            "zip"
        ],
        "darwin": [
            "dmg",
            "zip"
        ],
        "linux": [
            "deb",
            "zip"
        ]
    },
    "electronPackagerConfig": {
        "executableName": "httptoolkit",
        "packageManager": "npm",
        "icon": "./src/icon",
        "ignore": [
            "certificates"
        ],
        "afterCopy": ["./src/hooks/after-copy.js"],
        "appBundleId": "tech.httptoolkit.desktop",
        "appCategoryType": "public.app-category.developer-tools",
        "osxSign": {
            "keychain": "httptoolkit-build.keychain",
            "gatekeeper-assess": false,
            "hardened-runtime": true,
            "entitlements": "src/entitlements.plist",
            "entitlements-inherit": "src/entitlements.plist"
        }
    },
    "electronWinstallerConfig": {
        "name": "httptoolkit",
        "title": "HTTP Toolkit",
        "exe": "httptoolkit.exe",
        "iconUrl": "https://httptoolkit.tech/favicon.ico",
        "setupIcon": "./src/icon.ico",
        "loadingGif": "./src/installing.gif",
        "signWithParams": `/a /f "${
            path.resolve('./certificates/encrypted-win-cert.pfx')
        }" /p "${
            ELECTRON_FORGE_ELECTRON_WINSTALLER_CONFIG_CERTIFICATE_PASSWORD
        }" /tr http://timestamp.comodoca.com/ /td sha256`
    },
    "electronInstallerDMG": {
        "name": "HTTP Toolkit",
        "icon": "src/icon.icns",
        "background": "src/dmg-background.png"
    },
    "electronInstallerDebian": {
        "name": "httptoolkit",
        "bin": "httptoolkit",
        "icon": "src/icon.png",
        "homepage": "https://httptoolkit.tech",
        "categories": [
            "Development",
            "Network"
        ]
    },
    "github_repository": {
        "owner": "httptoolkit",
        "name": "httptoolkit-desktop"
    },
    "hooks": {
        "postPackage": require("./src/hooks/post-package.js")
    }
}