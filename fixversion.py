#!/usr/bin/env python3
import json
import os
import sys
import subprocess
import platform

def run_npm_install(directory='.', default='y'):
    abspath = os.path.abspath(directory)
    response = input(f"Do you want to run 'npm install' in {abspath}? (Y/n): ").strip() or default
    if response.lower() == 'y':
        # Use powershell on Windows, otherwise use bash
        shell = True if platform.system() == 'Windows' else False
        subprocess.run(['npm', 'install'], cwd=abspath, shell=shell)

args = sys.argv[1:]

build_pkg = json.load(open('package.json'))
ver = build_pkg['version']
app_pkg = json.load(open('app/package.json'))
appver = app_pkg['version']

if len(args) > 0:
    newver = args[0]
else:
    newver = ver
print(f'Updating package.json and app/package.json to {newver}')

build_pkg['version'] = newver
app_pkg['version'] = newver

with open('app/package.json', 'w') as f:
    json.dump(app_pkg, f, indent=2)
    f.write('\n')
with open('package.json', 'w') as f:
    json.dump(build_pkg, f, indent=2)
    f.write('\n')

# Prompt for npm install in both directories
run_npm_install()  # Root directory
run_npm_install('app')  # App directory
