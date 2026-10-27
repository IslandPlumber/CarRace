"""Refine the CC0 stock-car mesh with small manufactured edge radii.

Run with installed Blender:
blender --background --python tools/prepare-car.py
Source: WiyantoID, Stock Camry NS, CC0. See assets/CREDITS.md.
"""
from pathlib import Path
import bpy
import math

root=Path(__file__).resolve().parents[1]
bpy.ops.wm.read_factory_settings(use_empty=True)
bpy.ops.import_scene.gltf(filepath=str(root/'assets/source/stock-camry-ns.glb'))
for obj in list(bpy.context.scene.objects):
    if obj.type!='MESH':
        continue
    if obj.name.startswith('body_standard'):
        bevel=obj.modifiers.new('Manufactured edge radius','BEVEL')
        bevel.width=.006
        bevel.segments=3
        bevel.limit_method='ANGLE'
        bevel.angle_limit=math.radians(28)
        bevel.affect='EDGES'
        bevel.harden_normals=True
        bpy.context.view_layer.objects.active=obj
        bpy.ops.object.modifier_apply(modifier=bevel.name)
    for face in obj.data.polygons:
        material=obj.data.materials[face.material_index]
        if material and (material.name.startswith('Body_') or material.name in ('Tire','Rims','Wing')):
            face.use_smooth=True
    weighted=obj.modifiers.new('Area weighted panel normals','WEIGHTED_NORMAL')
    weighted.keep_sharp=True
    weighted.weight=50
    bpy.context.view_layer.objects.active=obj
    bpy.ops.object.modifier_apply(modifier=weighted.name)
bpy.ops.export_scene.gltf(filepath=str(root/'assets/cars/stock-car.glb'),export_format='GLB',export_apply=True,export_yup=True)
print('Refined stock-car model exported.')
