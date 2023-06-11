"""Simple script for generating an image of a resource in a specified color
"""

from itertools import product
from PIL import Image

resource = input('Enter resource name: ').lower()
image = Image.open(f'{resource}_white.png')
hex = input('Enter new color in hexadecimal format: ').lstrip('#') + 'ff'
color = tuple(int(hex[i : i + 2], 16) for i in range(0, 8, 2))

for x, y in product(range(image.size[0]), range(image.size[1])):
    pixel = image.getpixel((x, y))
    new_color = tuple(int(color[i] * pixel[i] / 255) for i in range(4))
    image.putpixel((x, y), new_color)

image.save(f'{resource}_new.png')
print('Image saved')
