/* Flat program image loaded at 0x80000400 by boot/ipl3.S */
ENTRY(_start)
SECTIONS {
  . = 0x80000400;
  .text : { *(.text.start) *(.text .text.*) }
  .rodata : { *(.rodata .rodata.*) *(.lit4) *(.lit8) }
  .data : { *(.data .data.*) *(.sdata .sdata.*) }
  . = ALIGN(16);
  __bss_start = .;
  .bss (NOLOAD) : { *(.sbss .sbss.*) *(.bss .bss.*) *(COMMON) }
  . = ALIGN(16);
  __bss_end = .;
  _end = .;
  /DISCARD/ : { *(.MIPS.abiflags) *(.reginfo) *(.comment) *(.pdr) *(.gnu.attributes) *(.mdebug.*) }
}
