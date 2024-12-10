# ATV Desktop Remote
A simple menubar app that allows you to control an Apple TV from your desktop

 ![What this application looks like when running in either light or dark mode](screenshot.png)

 ## Download

 I've created macOS and Windows releases available here: [/releases](/releases)

## Usage

 1. All of the keys are mapped to the keyboard when the application is open (pressing return or enter on the keyboard for select, delete for Menu, etc).
 2. To see what the characters are mapped to when the application is open, click the question mark icon.

## FAQ

1. The application cannot be opened (`“ATV Remote.app” is damaged and can’t be opened`)
   * This is an artifact of the MacOS quarantine of unsigned applications
   * You can bypass it by running `xattr -c  /Applications/ATV\ Remote.app`

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

## Version Bump

1. To increment the semvar version number: `python fixversion.py 1.2.3`
2. Update package locks in both `.` and `app/`: `npm install && cd app/ && npm install`

## Update: Keyboard input works

The latest version works with tvOS 15 and up. It requires Python 3 to be installed on the system to work properly.

When the program starts, it will attempt to install the necessary modules for Python to work properly. If you have custom scripts under the working directory, please check the release notes for v1.1.1 to see what steps you need to take for this to work for you.
On first run this program will run `pip` to install modules under a self-contained `env` directory. This program still works as it used to once it is running, but it does use a more complex method for communicating with the Apple TV.

Also note if you don't see an option for entering text, you may need to pair with your ATV again. You have to enter 2 codes instead of 1 because sending text to search fields uses a different protocol.

## Notes

This is cobbled together from a few projects I've worked on. It works well enough for me for daily use, so I figured others might like it. 

This project is built using [pyatv.](https://pyatv.dev/)

[![ko-fi](https://ko-fi.com/img/githubbutton_sm.svg)](https://ko-fi.com/brianharper)
