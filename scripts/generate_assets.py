import os
import math
from PIL import Image, ImageDraw, ImageColor

# --- Mesh Utilities ---

class Mesh:
    def __init__(self):
        self.vertices = []
        self.uvs = []
        self.faces = []

    def add_vertex(self, x, y, z):
        self.vertices.append((x, y, z))
        return len(self.vertices) - 1

    def add_uv(self, u, v):
        self.uvs.append((u, v))
        return len(self.uvs) - 1

    def add_face(self, v_indices, uv_indices=None):
        self.faces.append((v_indices, uv_indices))

    def save_obj(self, filename):
        with open(filename, 'w') as f:
            f.write(f"# Generated Model: {os.path.basename(filename)}\n")
            for v in self.vertices:
                f.write(f"v {v[0]:.4f} {v[1]:.4f} {v[2]:.4f}\n")
            for uv in self.uvs:
                f.write(f"vt {uv[0]:.4f} {uv[1]:.4f}\n")
            for v_inds, uv_inds in self.faces:
                line = "f"
                for i in range(len(v_inds)):
                    v_idx = v_inds[i] + 1
                    if uv_inds:
                        uv_idx = uv_inds[i % len(uv_inds)] + 1 # Cycle UVs if fewer provided
                        line += f" {v_idx}/{uv_idx}"
                    else:
                        line += f" {v_idx}"
                f.write(line + "\n")

# --- Texture Utilities ---

def create_texture(filename, width, height, bg_color, fg_color, pattern):
    try:
        bg = ImageColor.getrgb(bg_color)
        fg = ImageColor.getrgb(fg_color)
    except:
        bg = bg_color # assume tuple if failed
        fg = fg_color

    img = Image.new('RGB', (width, height), bg)
    draw = ImageDraw.Draw(img)

    if pattern == 'checkerboard':
        size = 32
        for y in range(0, height, size):
            for x in range(0, width, size):
                if ((x // size) + (y // size)) % 2 == 1:
                    draw.rectangle([x, y, x + size, y + size], fill=fg)
    elif pattern == 'h_stripes':
        size = 32
        for y in range(0, height, size * 2):
            draw.rectangle([0, y, width, y + size], fill=fg)
    elif pattern == 'v_stripes':
        size = 32
        for x in range(0, width, size * 2):
            draw.rectangle([x, 0, x + size, height], fill=fg)
    elif pattern == 'grid':
        size = 32
        for x in range(0, width, size):
            draw.line([(x, 0), (x, height)], fill=fg, width=2)
        for y in range(0, height, size):
            draw.line([(0, y), (width, y)], fill=fg, width=2)
    elif pattern == 'dots':
        radius = 10
        spacing = 40
        for y in range(spacing // 2, height, spacing):
            for x in range(spacing // 2, width, spacing):
                draw.ellipse([x - radius, y - radius, x + radius, y + radius], fill=fg)
    elif pattern == 'crosshatch':
        step = 20
        for i in range(0, width + height, step):
            draw.line([(i, 0), (0, i)], fill=fg, width=2)
            draw.line([(i - height, height), (i, 0)], fill=fg, width=2)
    elif pattern == 'concentric':
        center_x, center_y = width // 2, height // 2
        for r in range(width // 2, 0, -20):
            draw.ellipse([center_x - r, center_y - r, center_x + r, center_y + r], outline=fg, width=5)
    elif pattern == 'zigzag':
        step = 20
        amp = 20
        for y in range(0, height, step * 2):
            points = []
            for x in range(0, width + step, step):
                offset_y = amp if (x // step) % 2 == 0 else -amp
                points.append((x, y + offset_y))
            draw.line(points, fill=fg, width=3)
    elif pattern == 'noise':
        import random
        pixels = img.load()
        for y in range(height):
            for x in range(width):
                if random.random() > 0.5:
                    pixels[x, y] = fg
    elif pattern == 'gradient':
        c1 = bg
        c2 = fg
        for y in range(height):
            r = int(c1[0] + (c2[0] - c1[0]) * y / height)
            g = int(c1[1] + (c2[1] - c1[1]) * y / height)
            b = int(c1[2] + (c2[2] - c1[2]) * y / height)
            draw.line([(0, y), (width, y)], fill=(r, g, b))

    img.save(filename)

# --- Shape Generators ---

def create_cube():
    m = Mesh()
    pts = [
        (-1, -1, -1), (1, -1, -1), (1, 1, -1), (-1, 1, -1), # Back
        (-1, -1, 1), (1, -1, 1), (1, 1, 1), (-1, 1, 1)      # Front
    ]
    for p in pts: m.add_vertex(*p)
    uvs = [(0,0), (1,0), (1,1), (0,1)]
    for uv in uvs: m.add_uv(*uv)
    faces = [
        ([0, 1, 2, 3], [0, 1, 2, 3]), ([4, 5, 6, 7], [0, 1, 2, 3]),
        ([0, 4, 7, 3], [0, 1, 2, 3]), ([1, 5, 6, 2], [0, 1, 2, 3]),
        ([3, 2, 6, 7], [0, 1, 2, 3]), ([0, 1, 5, 4], [0, 1, 2, 3])
    ]
    for f in faces: m.add_face(f[0], f[1])
    return m

def create_pyramid():
    m = Mesh()
    pts = [(-1, 0, -1), (1, 0, -1), (1, 0, 1), (-1, 0, 1), (0, 1.5, 0)]
    for p in pts: m.add_vertex(*p)
    uvs = [(0,0), (1,0), (1,1), (0,1), (0.5, 1)]
    for uv in uvs: m.add_uv(*uv)
    m.add_face([0, 3, 2, 1], [0, 3, 2, 1])
    m.add_face([0, 1, 4], [0, 1, 4])
    m.add_face([1, 2, 4], [0, 1, 4])
    m.add_face([2, 3, 4], [0, 1, 4])
    m.add_face([3, 0, 4], [0, 1, 4])
    return m

def create_prism(sides=3):
    m = Mesh()
    h, r = 2.0, 1.0
    top_indices, bottom_indices = [], []
    for i in range(sides):
        angle = 2 * math.pi * i / sides
        x, z = r * math.cos(angle), r * math.sin(angle)
        m.add_vertex(x, -h/2, z); bottom_indices.append(len(m.vertices)-1)
        m.add_vertex(x, h/2, z); top_indices.append(len(m.vertices)-1)

    m.add_uv(0, 0); m.add_uv(1, 0); m.add_uv(1, 1); m.add_uv(0, 1)
    for i in range(sides):
        next_i = (i + 1) % sides
        m.add_face([bottom_indices[i], bottom_indices[next_i], top_indices[next_i], top_indices[i]], [0, 1, 2, 3])

    # Simple planar UV for caps (just 0,0 1,0 0,1 etc or mapped) - reusing quad UVs roughly
    m.add_face(bottom_indices[::-1], [0, 1, 2] * (sides // 3 + 1))
    m.add_face(top_indices, [0, 1, 2] * (sides // 3 + 1))
    return m

def create_cylinder(segments=12):
    return create_prism(segments)

def create_cone(segments=12):
    m = Mesh()
    h, r = 2.0, 1.0
    base_indices = []
    for i in range(segments):
        angle = 2 * math.pi * i / segments
        x, z = r * math.cos(angle), r * math.sin(angle)
        m.add_vertex(x, -h/2, z); base_indices.append(len(m.vertices)-1)
    apex_idx = m.add_vertex(0, h/2, 0)
    m.add_uv(0, 0); m.add_uv(1, 0); m.add_uv(0.5, 1)
    for i in range(segments):
        next_i = (i + 1) % segments
        m.add_face([base_indices[i], base_indices[next_i], apex_idx], [0, 1, 2])
    m.add_face(base_indices[::-1], [0, 1, 2] * (segments//3 + 1))
    return m

def create_octahedron():
    m = Mesh()
    pts = [(1,0,0), (-1,0,0), (0,1,0), (0,-1,0), (0,0,1), (0,0,-1)]
    for p in pts: m.add_vertex(*p)
    tris = [(0, 2, 4), (2, 1, 4), (1, 3, 4), (3, 0, 4), (2, 0, 5), (1, 2, 5), (3, 1, 5), (0, 3, 5)]
    m.add_uv(0,0); m.add_uv(1,0); m.add_uv(0.5, 1)
    for t in tris: m.add_face(list(t), [0, 1, 2])
    return m

def create_diamond():
    m = Mesh()
    pts = [(0.5,0,0.5), (-0.5,0,0.5), (-0.5,0,-0.5), (0.5,0,-0.5), (0, 1.5, 0), (0, -1.5, 0)]
    for p in pts: m.add_vertex(*p)
    m.add_uv(0,0); m.add_uv(1,0); m.add_uv(0.5, 1)
    # Top
    for face in [[0, 3, 4], [3, 2, 4], [2, 1, 4], [1, 0, 4]]:
        m.add_face(face, [0, 1, 2])
    # Bottom
    for face in [[0, 1, 5], [1, 2, 5], [2, 3, 5], [3, 0, 5]]:
        m.add_face(face, [0, 1, 2])
    return m

def create_star():
    m = Mesh()
    points = 5; outer_r = 1.0; inner_r = 0.4; depth = 0.5
    front_v, back_v = [], []
    for i in range(points * 2):
        angle = math.pi * i / points
        r = outer_r if i % 2 == 0 else inner_r
        x, y = r * math.sin(angle), r * math.cos(angle)
        m.add_vertex(x, y, depth/2); front_v.append(len(m.vertices)-1)
        m.add_vertex(x, y, -depth/2); back_v.append(len(m.vertices)-1)
    cf = m.add_vertex(0, 0, depth/2)
    cb = m.add_vertex(0, 0, -depth/2)
    m.add_uv(0, 0); m.add_uv(1, 0); m.add_uv(0.5, 1) # Tri UVs
    m.add_uv(0, 0); m.add_uv(1, 0); m.add_uv(1, 1); m.add_uv(0, 1) # Quad UVs

    for i in range(points * 2):
        next_i = (i + 1) % (points * 2)
        m.add_face([front_v[i], front_v[next_i], cf], [0, 1, 2])
        m.add_face([back_v[next_i], back_v[i], cb], [0, 1, 2])
        m.add_face([front_v[i], back_v[i], back_v[next_i], front_v[next_i]], [3, 4, 5, 6])
    return m

def create_cross():
    m = Mesh()
    w, l, d = 0.5, 1.5, 0.5
    coords = [(-w, l), (w, l), (w, w), (l, w), (l, -w), (w, -w), (w, -l), (-w, -l), (-w, -w), (-l, -w), (-l, w), (-w, w)]
    front, back = [], []
    # Planar UV mapping for front/back faces based on coords (normalized to 0-1)
    uvs_front = []
    for x, y in coords:
        m.add_vertex(x, y, d); front.append(len(m.vertices)-1)
        m.add_vertex(x, y, -d); back.append(len(m.vertices)-1)
        # Map x,y from [-1.5, 1.5] to [0, 1]
        u = (x + 1.5) / 3.0
        v = (y + 1.5) / 3.0
        uvs_front.append(m.add_uv(u, v))

    m.add_face(front, uvs_front)
    m.add_face(back[::-1], uvs_front[::-1])

    # Side UVs (Quad)
    quad_uvs = [m.add_uv(0, 0), m.add_uv(1, 0), m.add_uv(1, 1), m.add_uv(0, 1)]

    for i in range(12):
        next_i = (i + 1) % 12
        m.add_face([front[i], front[next_i], back[next_i], back[i]], quad_uvs)
    return m

def create_torus(r_main=1.5, r_tube=0.4, segments_main=16, segments_tube=8):
    m = Mesh()
    grid = []
    for i in range(segments_main + 1): # +1 to close loop with distinct UVs
        theta = 2 * math.pi * (i % segments_main) / segments_main
        cos_theta, sin_theta = math.cos(theta), math.sin(theta)
        ring_indices = []
        for j in range(segments_tube + 1):
            phi = 2 * math.pi * (j % segments_tube) / segments_tube
            cos_phi, sin_phi = math.cos(phi), math.sin(phi)
            x = (r_main + r_tube * cos_phi) * cos_theta
            y = (r_main + r_tube * cos_phi) * sin_theta
            z = r_tube * sin_phi

            # Vertex
            v_idx = m.add_vertex(x, y, z)
            # UV
            uv_idx = m.add_uv(i / segments_main, j / segments_tube)
            ring_indices.append((v_idx, uv_idx))
        grid.append(ring_indices)

    for i in range(segments_main):
        for j in range(segments_tube):
            p1 = grid[i][j]
            p2 = grid[i+1][j]
            p3 = grid[i+1][j+1]
            p4 = grid[i][j+1]

            m.add_face([p1[0], p2[0], p3[0], p4[0]], [p1[1], p2[1], p3[1], p4[1]])
    return m

def main():
    model_dir = "public/models"
    tex_dir = "public/models/textures"
    os.makedirs(model_dir, exist_ok=True)
    os.makedirs(tex_dir, exist_ok=True)

    create_cube().save_obj(f"{model_dir}/cube.obj")
    create_texture(f"{tex_dir}/cube_tex.png", 256, 256, "white", "black", "checkerboard")

    create_pyramid().save_obj(f"{model_dir}/pyramid.obj")
    create_texture(f"{tex_dir}/pyramid_tex.png", 256, 256, "yellow", "red", "h_stripes")

    create_prism(3).save_obj(f"{model_dir}/prism.obj")
    create_texture(f"{tex_dir}/prism_tex.png", 256, 256, "blue", "cyan", "v_stripes")

    create_cylinder(12).save_obj(f"{model_dir}/cylinder.obj")
    create_texture(f"{tex_dir}/cylinder_tex.png", 256, 256, "lightgray", "darkgray", "grid")

    create_cone(12).save_obj(f"{model_dir}/cone.obj")
    create_texture(f"{tex_dir}/cone_tex.png", 256, 256, "green", "lime", "dots")

    create_octahedron().save_obj(f"{model_dir}/octahedron.obj")
    create_texture(f"{tex_dir}/octahedron_tex.png", 256, 256, "purple", "orange", "crosshatch")

    create_diamond().save_obj(f"{model_dir}/diamond.obj")
    create_texture(f"{tex_dir}/diamond_tex.png", 256, 256, "navy", "white", "concentric")

    create_star().save_obj(f"{model_dir}/star.obj")
    create_texture(f"{tex_dir}/star_tex.png", 256, 256, "gold", "brown", "zigzag")

    create_cross().save_obj(f"{model_dir}/cross.obj")
    create_texture(f"{tex_dir}/cross_tex.png", 256, 256, "red", "white", "noise")

    create_torus().save_obj(f"{model_dir}/torus.obj")
    create_texture(f"{tex_dir}/torus_tex.png", 256, 256, "black", "white", "gradient")

    print("Assets generated successfully.")

if __name__ == "__main__":
    main()
