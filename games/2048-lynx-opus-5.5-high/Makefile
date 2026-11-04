# Build hex2048.lnx with cc65. Run ./build.sh to do this inside Docker.
CL65    = cl65
CFLAGS  = -t lynx -Oirs $(EXTRA)
SOURCES = src/main.c src/vbl.s src/header.s

hex2048.lnx: $(SOURCES)
	$(CL65) $(CFLAGS) -m build/hex2048.map -o $@ $(SOURCES)
	rm -f src/*.o

clean:
	rm -f hex2048.lnx src/*.o build/hex2048.map

.PHONY: clean
