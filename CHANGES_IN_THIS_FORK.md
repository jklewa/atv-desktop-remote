# Changes in This Fork

This fork of [bsharper/atv-desktop-remote](https://github.com/bsharper/atv-desktop-remote) includes significant enhancements that improve both the user experience and developer workflow. The changes are organized into two main categories:

## User Experience Improvements

These changes directly enhance the functionality and usability for end users:

### **Dark Mode Support**
- Full dark mode implementation with automatic system theme detection
- Manual theme override options (light mode, dark mode, system mode)
- Consistent dark mode styling across all application windows

### **Enhanced Keyboard Shortcuts**
- Comprehensive keyboard mapping with visual shortcut guide
- Question mark icon to display all available keyboard shortcuts
- Improved keyboard navigation and accessibility

### **Customizable Global Hotkey**
- Dedicated interface for changing the global hotkey combination
- Support for platform-specific hotkey configurations
- Persistent hotkey settings with validation

### **Text Input Window**
- Dedicated window for typing text into Apple TV search fields
- Real-time visual feedback showing connection status
- Improved text input handling with debounced updates

### **Always On Top Option**
- Option to keep the remote window always visible above other applications
- Persistent setting that remembers user preference

### **Cross-Platform Enhancements**
- Improved Windows and Linux support with platform-specific optimizations
- Better platform detection and feature adaptation
- Enhanced file path handling across different operating systems

## Developer and Project Enhancements

These changes improve the development workflow, build process, and project maintainability:

### **Automated CI/CD Pipeline**
- GitHub Actions workflow for automated builds across multiple platforms
- Release automation with proper tagging and asset management
- Cross-platform build support (macOS, Windows, Linux)

### **Enhanced Build System**
- Improved electron-builder configuration with multi-platform targets
- Python script embedding system for better distribution
- Enhanced packaging with proper code signing setup

### **Developer Tools**
- `fixversion.py` script for automated version management across package files
- `generate_screenshot.py` for automatic documentation screenshot generation
- Streamlined development workflow with better tooling

### **Improved Backend Integration**
- Enhanced Python server management with better error handling
- Restart mechanisms and failure recovery for the backend server
- Improved WebSocket communication and connection management

### **Code Organization**
- Enhanced logging system with better debugging capabilities
- Modular code structure with improved separation of concerns
- Better error handling and user feedback mechanisms

### **Enhanced Documentation**
- Comprehensive build instructions and requirements
- Improved FAQ section with common troubleshooting
- Better project organization and file structure

---

These enhancements maintain compatibility with the original project while significantly improving both the user experience and developer workflow. The fork focuses on production-ready features and robust cross-platform support.