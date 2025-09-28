import pyscreenrec
import webbrowser
import time
from moviepy.editor import VideoFileClip
from os import makedirs, remove
import sys
from PIL import Image, ImageSequence
import pyautogui

PORT = 3000
BASE_URL = f"http://localhost:{PORT}/#?"

GIF_FPS = 30


def create_website_window(
    scene: str, hide_ui: bool = False, shake_off: bool = True
) -> None:
    """Open a new screen that has
    www.nteague.com/#?scene=scene&shake=off(hide_ui && '&hide=yes')?

    Args:
        url_suffix (str):
    """
    url: str = BASE_URL + f"scene={scene}"

    url += "&shake=off" if shake_off else ""
    url += "&hide=true" if hide_ui else ""

    webbrowser.open(url, new=0)


RESIZE_FACTOR = 2


def convert_vid_to_gif(video_path: str, gif_path: str) -> None:
    videoClip = VideoFileClip(f"recordings/{video_path}.mp4")
    makedirs("outgifs/", exist_ok=True)
    videoClip.subclip(-3).resize(
        (int(1920 / RESIZE_FACTOR), int(920 / RESIZE_FACTOR))
    ).write_gif(f"outgifs/{gif_path}.gif", fps=GIF_FPS)


def do_record(scene_name: str, drag: bool) -> None:
    recorder = pyscreenrec.ScreenRecorder()
    makedirs("recordings", exist_ok=True)
    recorder.start_recording(
        f"recordings/{scene_name}.mp4",
        GIF_FPS,
        {"mon": 1, "left": 0, "top": 100, "width": 1920, "height": 920},
    )

    time.sleep(1)

    ## in case we get webpack error
    for _ in range(10):
        pyautogui.leftClick(1890, 120)
        time.sleep(0.1)

    if drag:
        time.sleep(7)
        pyautogui.moveTo(x=500, y=300)
        pyautogui.dragTo(x=1000, y=200, duration=1)
        pyautogui.dragTo(x=1500, y=300, duration=1)
    else:
        time.sleep(9)

    recorder.stop_recording()


def create_preview_gif(scene_name: str, drag: bool = False) -> None:
    create_website_window(scene_name)
    do_record(scene_name, drag)
    convert_vid_to_gif(scene_name, scene_name)
    pyautogui.hotkey("ctrl", "w")


create_preview_gif("rain", True)
