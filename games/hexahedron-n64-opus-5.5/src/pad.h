#ifndef PAD_H
#define PAD_H
#include "hw.h"

#define BTN_A 0x8000
#define BTN_B 0x4000
#define BTN_Z 0x2000
#define BTN_START 0x1000
#define BTN_DU 0x0800
#define BTN_DD 0x0400
#define BTN_DL 0x0200
#define BTN_DR 0x0100
#define BTN_L 0x0020
#define BTN_R 0x0010
#define BTN_CU 0x0008
#define BTN_CD 0x0004
#define BTN_CL 0x0002
#define BTN_CR 0x0001

typedef struct { u16 held, pressed; s8 sx, sy; } pad_t;
extern pad_t pad;
void pad_poll(void);
#endif
