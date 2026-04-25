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

Output coding-eat.gif

# Show the eat-small scene — triggered by a feed event
Type "glyphling capture eat-small --fps 15 --duration 4"
Enter
Sleep 4500ms
