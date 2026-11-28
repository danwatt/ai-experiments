/* PS-EXE layout: code loaded at 0x80010000 by the BIOS (or emulator HLE). */
OUTPUT_FORMAT("elf32-tradlittlemips")
OUTPUT_ARCH(mips)
ENTRY(_start)

SECTIONS
{
    . = 0x80010000;
    .text : {
        *(.text.start)
        *(.text .text.*)
    }
    .rodata : { *(.rodata .rodata.*) }
    .data : { *(.data .data.*) *(.sdata .sdata.*) }
    . = ALIGN(4);
    .bss (NOLOAD) : {
        __bss_start = .;
        *(.bss .bss.*) *(.sbss .sbss.*) *(COMMON)
        . = ALIGN(4);
        __bss_end = .;
    }
    /DISCARD/ : {
        *(.MIPS.abiflags) *(.reginfo) *(.comment) *(.note*) *(.pdr)
        *(.gnu.attributes) *(.mdebug*) *(.eh_frame*)
    }
}
