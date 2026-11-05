#include "mathx.h"

float sinf_(float x)
{
    /* reduce to [-pi, pi] then a 7th-order odd polynomial on [-pi/2, pi/2] */
    float k = x * (1.0f / (2 * PI_F));
    x -= (float)floori(k + 0.5f) * (2 * PI_F);
    if (x > PI_F * 0.5f) x = PI_F - x;
    else if (x < -PI_F * 0.5f) x = -PI_F - x;
    float x2 = x * x;
    return x * (1.0f - x2 * (1.0f / 6 - x2 * (1.0f / 120 - x2 * (1.0f / 5040))));
}

float expf_(float x)
{
    if (x < -20) return 0;
    if (x > 20) x = 20;
    /* e^x = 2^(x/ln2): integer part by repeated squaring, fraction by polynomial */
    float y = x * 1.44269504f;
    int i = floori(y);
    float f = (y - i) * 0.69314718f;
    float r = 1 + f * (1 + f * (0.5f + f * (1.0f / 6 + f * (1.0f / 24 + f * (1.0f / 120)))));
    float p = 1, b = i < 0 ? 0.5f : 2.0f;
    int n = i < 0 ? -i : i;
    while (n) { if (n & 1) p *= b; b *= b; n >>= 1; }
    return r * p;
}

static vec3 rot(vec3 v, vec3 axis, float c, float s)
{
    /* Rodrigues: v*c + (axis x v)*s + axis*(axis.v)*(1-c) */
    return vadd(vadd(vmul(v, c), vmul(vcross(axis, v), s)), vmul(axis, vdot(axis, v) * (1 - c)));
}

void basis_rotate(basis_t *b, float pitch, float yaw, float roll)
{
    float c, s;
    if (pitch != 0) { c = cosf_(pitch); s = sinf_(pitch); vec3 ax = b->r; b->u = rot(b->u, ax, c, s); b->f = rot(b->f, ax, c, s); }
    if (yaw != 0)   { c = cosf_(yaw);   s = sinf_(yaw);   vec3 ax = b->u; b->r = rot(b->r, ax, c, s); b->f = rot(b->f, ax, c, s); }
    if (roll != 0)  { c = cosf_(roll);  s = sinf_(roll);  vec3 ax = b->f; b->r = rot(b->r, ax, c, s); b->u = rot(b->u, ax, c, s); }
}

void basis_orthonormalize(basis_t *b)
{
    b->f = vnorm(b->f);
    b->r = vnorm(vcross(b->f, b->u));   /* y-up world: right = forward x up */
    b->u = vcross(b->r, b->f);
}

/* Turn the forward axis towards dir by at most maxang radians, keeping up roughly level. */
void basis_turn_towards(basis_t *b, vec3 dir, float maxang)
{
    dir = vnorm(dir);
    float d = clampf(vdot(b->f, dir), -1, 1);
    vec3 axis = vcross(b->f, dir);
    float sl = vlen(axis);
    if (sl < 1e-4f) { if (d > 0) return; axis = b->u; sl = 1; }
    axis = vmul(axis, 1.0f / sl);
    /* angle between = atan2(sl, d); approximate when small */
    float ang = sl;
    if (d < 0) ang = PI_F - sl;
    if (ang > maxang) ang = maxang;
    float c = cosf_(ang), s = sinf_(ang);
    b->f = rot(b->f, axis, c, s);
    b->u = rot(b->u, axis, c, s);
    /* drift up towards world up so robots don't end upside down */
    b->u = vnorm(vadd(b->u, v3(0, 0.02f, 0)));
    basis_orthonormalize(b);
}

static u32 rs = 0x9E3779B9u;
u32 rnd(void) { rs ^= rs << 13; rs ^= rs >> 17; rs ^= rs << 5; return rs; }
float frand(float lo, float hi) { return lo + (hi - lo) * (float)(rnd() & 0xFFFFFF) * (1.0f / 16777216.0f); }
