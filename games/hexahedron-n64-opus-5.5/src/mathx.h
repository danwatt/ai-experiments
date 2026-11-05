#ifndef MATHX_H
#define MATHX_H
#include "hw.h"

typedef struct { float x, y, z; } vec3;

#define PI_F 3.14159265f
static inline float sqrtf_(float x) { return x > 0 ? __builtin_sqrtf(x) : 0; }
static inline float absf(float x) { return x < 0 ? -x : x; }
static inline float minf(float a, float b) { return a < b ? a : b; }
static inline float maxf(float a, float b) { return a > b ? a : b; }
static inline float clampf(float v, float lo, float hi) { return v < lo ? lo : v > hi ? hi : v; }
static inline int floori(float f) { int i = (int)f; return i - (f < (float)i); }

float sinf_(float x);
static inline float cosf_(float x) { return sinf_(x + PI_F * 0.5f); }
float expf_(float x);

static inline vec3 v3(float x, float y, float z) { vec3 r = { x, y, z }; return r; }
static inline vec3 vadd(vec3 a, vec3 b) { return v3(a.x + b.x, a.y + b.y, a.z + b.z); }
static inline vec3 vsub(vec3 a, vec3 b) { return v3(a.x - b.x, a.y - b.y, a.z - b.z); }
static inline vec3 vmul(vec3 a, float s) { return v3(a.x * s, a.y * s, a.z * s); }
static inline vec3 vmad(vec3 a, vec3 b, float s) { return v3(a.x + b.x * s, a.y + b.y * s, a.z + b.z * s); }
static inline float vdot(vec3 a, vec3 b) { return a.x * b.x + a.y * b.y + a.z * b.z; }
static inline vec3 vcross(vec3 a, vec3 b) { return v3(a.y * b.z - a.z * b.y, a.z * b.x - a.x * b.z, a.x * b.y - a.y * b.x); }
static inline float vlen2(vec3 a) { return vdot(a, a); }
static inline float vlen(vec3 a) { return sqrtf_(vdot(a, a)); }
static inline vec3 vnorm(vec3 a) { float l = vlen(a); return l > 1e-6f ? vmul(a, 1.0f / l) : v3(0, 0, 1); }
static inline vec3 vlerp(vec3 a, vec3 b, float t) { return v3(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, a.z + (b.z - a.z) * t); }

/* Orientation as three orthonormal axes: right (x), up (y), forward (z). */
typedef struct { vec3 r, u, f; } basis_t;
void basis_rotate(basis_t *b, float pitch, float yaw, float roll);
void basis_orthonormalize(basis_t *b);
void basis_turn_towards(basis_t *b, vec3 dir, float maxang);

/* xorshift PRNG */
u32 rnd(void);
float frand(float lo, float hi);
#endif
