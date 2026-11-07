"""Аудио-адаптер: разбор страницы плеера без выполнения скриптов. Владелец: Участник 1."""
from cqa.audio import extract_media_src

PAGE = """<html><body><h1>Воспроизведение записи</h1>
<audio id="myAudio" controls><source src="https://crm.example.com/api/filedownload/1?sp=r&amp;sig=x" type="audio/mpeg"></audio>
<script>alert(1)</script></body></html>"""


def test_extracts_source_and_unescapes():
    assert extract_media_src(PAGE) == "https://crm.example.com/api/filedownload/1?sp=r&sig=x"


def test_rejects_non_https_and_missing():
    assert extract_media_src('<source src="http://x/a.mp3">') is None
    assert extract_media_src("<html>нет плеера</html>") is None
