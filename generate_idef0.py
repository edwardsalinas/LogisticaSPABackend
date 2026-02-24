import sys
import subprocess

try:
    import matplotlib.pyplot as plt
    import matplotlib.patches as patches
except ImportError:
    subprocess.check_call([sys.executable, "-m", "pip", "install", "matplotlib"])
    import matplotlib.pyplot as plt
    import matplotlib.patches as patches

# Configuración de lienzo
fig, ax = plt.subplots(figsize=(14, 8))
fig.patch.set_facecolor('#F8F9FA')  # Fondo claro
ax.set_xlim(0, 14)
ax.set_ylim(0, 8)
ax.axis('off')

# --- CAJA CENTRAL (Proceso) ---
box_x, box_y = 5.0, 2.5
box_w, box_h = 4.0, 3.0

# Dibujar la caja (Color amarillo puro tipo IDEF0)
rect = patches.Rectangle((box_x, box_y), box_w, box_h, linewidth=2, edgecolor='#FFA000', facecolor='#FFC107')
ax.add_patch(rect)

# Texto dentro de la caja
plt.text(box_x + box_w/2, box_y + box_h/2, "Gestionar Logística de\nBienes y Servicios\n(Asistido por IA)",
         ha='center', va='center', fontsize=14, fontweight='bold', color='white', 
         bbox=dict(facecolor='none', edgecolor='none'))

# Número de nodo (A0) en la esquina inferior derecha
plt.text(box_x + box_w - 0.15, box_y + 0.15, "A0",
         ha='right', va='bottom', fontsize=12, fontweight='bold', color='white')

# --- FUNCIÓN PARA FLECHAS ---
def draw_arrow(xt, yt, xh, yh, text, text_offset_x=0.0, text_offset_y=0.0, ha='center', va='center', is_input=False):
    # Dibuja la flecha
    ax.annotate("", xy=(xh, yh), xytext=(xt, yt),
                arrowprops=dict(arrowstyle="-|>", color="#5B9BD5", lw=1.5, mutation_scale=20))
    # Dibuja el texto
    if text:
        plt.text((xt+xh)/2 + text_offset_x, (yt+yh)/2 + text_offset_y, text, 
                 ha=ha, va=va, fontsize=11, color='#333333', fontweight='medium')

# --- ENTRADAS (Izquierda -> Derecha) ---
# Flechas desde x=1.0 hasta x=5.0
draw_arrow(1.0, 4.8, box_x, 4.8, "Solicitudes de Bienes/Servicios", text_offset_y=0.2, ha='center', va='bottom', is_input=True)
draw_arrow(1.0, 4.0, box_x, 4.0, "Catálogos de Proveedores", text_offset_y=0.2, ha='center', va='bottom', is_input=True)
draw_arrow(1.0, 3.2, box_x, 3.2, "Consultas en Lenguaje Natural", text_offset_y=0.2, ha='center', va='bottom', is_input=True)

# --- SALIDAS (Izquierda -> Derecha) ---
# Flechas desde x=9.0 hasta x=13.0
draw_arrow(box_x + box_w, 4.8, 13.0, 4.8, "Órdenes de Compra generadas", text_offset_y=0.2, ha='center', va='bottom')
draw_arrow(box_x + box_w, 4.0, 13.0, 4.0, "Bienes y Servicios Entregados", text_offset_y=0.2, ha='center', va='bottom')
draw_arrow(box_x + box_w, 3.2, 13.0, 3.2, "Respuestas y Reportes de IA", text_offset_y=0.2, ha='center', va='bottom')

# --- CONTROLES (Arriba -> Abajo) ---
# Flechas desde y=7.5 hasta y=5.5
draw_arrow(5.8, 7.5, 5.8, box_y + box_h, "Políticas de\nCompras", text_offset_x=0.15, ha='left', va='center')
draw_arrow(7.0, 7.5, 7.0, box_y + box_h, "Normativas\nLegales", text_offset_x=0.15, ha='left', va='center')
draw_arrow(8.2, 7.5, 8.2, box_y + box_h, "Presupuesto\nAprobado", text_offset_x=0.15, ha='left', va='center')

# --- MECANISMOS (Abajo -> Arriba) ---
# Flechas desde y=0.5 hasta y=2.5
draw_arrow(5.6, 0.5, 5.6, box_y, "Plataforma Web\n(React/Node.js)", text_offset_x=0.15, ha='left', va='center')
draw_arrow(7.0, 0.5, 7.0, box_y, "Agente IA\n(LangChain)", text_offset_x=0.15, ha='left', va='center')
draw_arrow(8.4, 0.5, 8.4, box_y, "Personal\n(Admin/Operador)", text_offset_x=0.15, ha='left', va='center')

# --- ETIQUETAS GENERALES (Para emular la imagen provista) ---
plt.text(2.0, 5.5, "Inputs", ha='center', va='center', fontsize=12, color='#555555')
plt.text(12.0, 5.5, "Outputs", ha='center', va='center', fontsize=12, color='#555555')
plt.text(4.5, 6.5, "Controls", ha='right', va='center', fontsize=12, color='#555555')
plt.text(4.5, 1.5, "Mechanisms", ha='right', va='center', fontsize=12, color='#555555')

plt.text(12.5, 7.5, "IDEF0", ha='center', va='center', fontsize=26, fontweight='bold', color='black')

plt.tight_layout()
plt.savefig("IDEF0_Plataforma_Logistica.png", bbox_inches='tight', dpi=300)
print("Diagram generated successfully as IDEF0_Plataforma_Logistica.png")
