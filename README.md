# ATV Desktop Remote
[![GitHub Downloads (all assets, all releases)](https://img.shields.io/github/downloads/jklewa/atv-desktop-remote/total?logo=github)](https://github.com/jklewa/atv-desktop-remote/releases)
[![GitHub last commit (branch)](https://img.shields.io/github/last-commit/jklewa/atv-desktop-remote/main)](https://github.com/jklewa/atv-desktop-remote/commits/main/)
![GitHub repo size](https://img.shields.io/github/repo-size/jklewa/atv-desktop-remote)
[![GitHub Release](https://img.shields.io/github/v/release/jklewa/atv-desktop-remote?include_prereleases)](https://github.com/jklewa/atv-desktop-remote/releases/latest)

*Feedback or issue? [File an issue](https://github.com/jklewa/atv-desktop-remote/issues)*

A simple menubar app that allows you to control an Apple TV from your desktop

 ![What this application looks like when running in either light or dark mode](screenshot.png)

## Download

MacOS, Windows & Linux releases are available here: [Releases](https://github.com/jklewa/atv-desktop-remote/releases)

## Usage

 1. All of the keys are mapped to the keyboard when the application is open (pressing return or enter on the keyboard for select, delete for Menu, etc).
 2. To see what the characters are mapped to when the application is open, click the question mark icon.

## FAQ

 1. The application cannot be opened (`“ATV Remote.app” is damaged and can’t be opened`)
    * This is an artifact of the MacOS quarantine of unsigned applications
    * You can bypass it by running `xattr -c  /Applications/ATV\ Remote.app`
 2. Apple TV will not pair
    * Make sure the Apple TV is on the same network as the computer running the application
    * Make sure `Settings -> AirPlay and HomeKit -> Allow Access` is set to either `Everyone or Anyone on the Same Network` and not `Only People Sharing This Home`
 3. I don't see an option for entering text
    * You may need to pair with your ATV again
    * You have to enter 2 codes instead of 1 because sending text to search fields uses a different protocol

## Running

 1. Run `npm install` or `yarn`
 2. Run `npm start` or `yarn start`
 3. The application runs in the menubar. Look for a tiny remote icon and click on it. Right-click for more options.
 4. The first time the app runs it will need to pair with an Apple TV. You can pair with more than one.
 5. Press `Cmd+Shift+R` to open the application from anywhere. On Windows its `Win+Shift+R`

## Building

1. `electron-builder` is used to create a standalone application.
2. `npm run build` builds MacOS, Windows, & Linux
3. Packages are stored in `dist/`
4. Pushing a new release tag (`v1.x.x`) also triggers a release with GitHub Actions
5. To update the application's screenshot: `python generate_screenshot.py`

## Version Bump

1. To increment the semvar version number: `python fixversion.py 1.2.3`
2. Update package locks in both `.` and `app/`: `npm install && cd app/ && npm install`

## Notes

This is a fork of the original project: [bsharper/atv-desktop-remote](https://github.com/bsharper/atv-desktop-remote)

This project is built using [pyatv.](https://pyatv.dev/)

Support the original author **bsharper**:

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/brianharper)
