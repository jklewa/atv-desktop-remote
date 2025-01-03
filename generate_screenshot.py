#!/usr/bin/env python3
from PIL import Image, ImageDraw, ImageFilter, ImageEnhance
import os
from selenium import webdriver
from selenium.webdriver.chrome.options import Options
from selenium.webdriver.chrome.service import Service as ChromeService
from webdriver_manager.chrome import ChromeDriverManager
import time

def capture_screenshot(is_dark_mode=False):
    width, height = 300, 506

    # Set up Chrome options
    chrome_options = Options()
    chrome_options.add_argument("--headless")
    chrome_options.add_argument("--hide-scrollbars")
    
    # Pass chrome_options to the Chrome WebDriver
    driver = webdriver.Chrome(service=ChromeService(executable_path=ChromeDriverManager().install()), options=chrome_options)
    
    # Use CDP to set viewport size
    driver.execute_cdp_cmd('Emulation.setDeviceMetricsOverride', {
        'width': width,
        'height': height,
        'deviceScaleFactor': 1,
        'mobile': False
    })
    
    # Load the file
    file_path = f"file://{os.path.abspath('app/index.html')}"
    driver.get(file_path)
    
    # Inject state to show connected UI
    script = """
    document.getElementById('topTextHeader').style.display = 'none';
    document.getElementById('topTextKBLink').style.display = 'block';
    document.querySelector('.directionTable').style.display = 'table';
    document.getElementById('statusText').style.display = 'none';
    document.getElementById('cmdFade').style.visibility = 'visible';
    document.getElementById('cmdFade').textContent = 'play/pause';
    document.getElementById('atvDropdownContainer').innerHTML = `<span class="ctText">&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;</span><span class="select2 select2-container select2-container--default" style="width: 300px;"><span class="selection"><span class="select2-selection select2-selection--single"><span class="select2-selection__rendered">Bedroom (192.168.1.X)</span><span class="select2-selection__arrow"><b></b></span></span></span><span class="dropdown-wrapper"></span></span>`;
    """
    
    if is_dark_mode:
        script += """
        document.body.classList.add('darkMode');
        document.getElementById('s2style-sheet').href = 'css/select2-inverted.css';
        """
    else:
        script += """
        document.body.classList.remove('darkMode');
        document.getElementById('s2style-sheet').href = 'css/select2.min.css';
        """
    
    driver.execute_script(script)

    # Wait for any animations
    time.sleep(1)
    
    # Take screenshot
    screenshot = f"temp_{'dark' if is_dark_mode else 'light'}.png"
    driver.save_screenshot(screenshot)
    driver.quit()
    return screenshot

def add_window_styling(img, radius=10):
    # Create a mask for rounded corners
    mask = Image.new('L', img.size, 0)
    draw = ImageDraw.Draw(mask)
    draw.rounded_rectangle([(0, 0), (img.size[0]-1, img.size[1]-1)], radius, fill=255)
    
    # Apply rounded corners
    output = Image.new('RGBA', img.size, (0, 0, 0, 0))
    output.paste(img, mask=mask)
    
    # Create shadow
    shadow = Image.new('RGBA', (img.size[0] + 20, img.size[1] + 20), (0, 0, 0, 0))
    shadow_draw = ImageDraw.Draw(shadow)
    shadow_draw.rounded_rectangle([(10, 10), (img.size[0] + 9, img.size[1] + 9)], radius, fill=(0, 0, 0, 80))
    shadow = shadow.filter(ImageFilter.GaussianBlur(8))
    
    # Combine shadow and image
    final = Image.new('RGBA', (img.size[0] + 20, img.size[1] + 20), (0, 0, 0, 0))
    final.paste(shadow, (0, 0))
    final.paste(output, (10, 10), mask=output)
    
    return final

def combine_screenshots(light_path, dark_path):
    light_img = Image.open(light_path).convert('RGBA')
    dark_img = Image.open(dark_path).convert('RGBA')
    
    # Add window styling to both screenshots
    light_img = add_window_styling(light_img)
    dark_img = add_window_styling(dark_img)
    
    # Create a new image with both screenshots side by side
    padding = 30  # Space between windows
    combined_width = light_img.width + dark_img.width + padding
    combined_height = max(light_img.height, dark_img.height) + 20  # Added vertical padding
    
    combined = Image.new('RGBA', (combined_width, combined_height), (0, 0, 0, 0))
    combined.paste(light_img, (0, 10), light_img)
    combined.paste(dark_img, (light_img.width + padding, 10), dark_img)
    
    # Save as PNG with transparency
    combined.save('screenshot.png', format='PNG', optimize=True)
    
    # Cleanup temp files
    os.remove(light_path)
    os.remove(dark_path)

def main():
    light = capture_screenshot(is_dark_mode=False)
    dark = capture_screenshot(is_dark_mode=True)
    combine_screenshots(light, dark)

if __name__ == "__main__":
    main()
