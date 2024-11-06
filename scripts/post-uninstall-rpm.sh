#!/bin/bash

# This check works only for RPMs
if [ $1 -ge 1 ]; then
    # Package upgrade, do not uninstall
    exit 0
fi

# Delete the link to the binary
if type update-alternatives >/dev/null 2>&1; then
    update-alternatives --remove "httptoolkit" "/opt/HTTP Toolkit/httptoolkit"
else
    rm -f "/usr/bin/httptoolkit"
fi