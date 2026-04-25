# --- glyphling house style ---
Set Shell "bash"
Set WindowBar ""
Set Margin 0
Set Padding 20
Set Theme "GruvboxDark"
Set FontSize 14
Set TypingSpeed 50ms
Set PlaybackSpeed 1.0
Set Framerate 24
# --- standard tier ---
Set Width 960
Set Height 240

Output hatch.gif

# Run hatch-crack → hatch-emerge sequence (~3.5s at 10fps)
Type "glyphling capture hatch-crack --fps 10 --duration 3"
Enter
Sleep 3500ms
