import matplotlib.pyplot as plt
import matplotlib.patches as patches

def generate_c4_context(filepath="C4_Context_Logistica.png"):
    fig, ax = plt.subplots(figsize=(10, 8))
    fig.patch.set_facecolor('#ffffff')
    ax.set_xlim(0, 10)
    ax.set_ylim(0, 8)
    ax.axis('off')

    # Actor: Cliente
    ax.add_patch(patches.Rectangle((1, 5), 2, 1, facecolor='#08427b', edgecolor='#052e56', lw=2, zorder=2))
    plt.text(2, 5.5, 'Cliente / Remitente\n[Persona]', color='white', ha='center', va='center', fontsize=10, fontweight='bold', zorder=3)

    # Actor: Despachador
    ax.add_patch(patches.Rectangle((1, 2), 2, 1, facecolor='#08427b', edgecolor='#052e56', lw=2, zorder=2))
    plt.text(2, 2.5, 'Despachador\n[Persona]', color='white', ha='center', va='center', fontsize=10, fontweight='bold', zorder=3)

    # Actor: Chofer
    ax.add_patch(patches.Rectangle((7, 5), 2, 1, facecolor='#08427b', edgecolor='#052e56', lw=2, zorder=2))
    plt.text(8, 5.5, 'Chofer / Operador\n[Persona]', color='white', ha='center', va='center', fontsize=10, fontweight='bold', zorder=3)

    # Sistema Central
    ax.add_patch(patches.Rectangle((3.5, 3), 3, 2, facecolor='#1168bd', edgecolor='#0b4884', lw=2, zorder=2))
    plt.text(5, 4, 'Plataforma Logística\nAsistida por IA\n[Sistema de Software]', color='white', ha='center', va='center', fontsize=11, fontweight='bold', zorder=3)

    # Relaciones
    # Cliente -> Sistema
    ax.annotate('', xy=(3.5, 4.5), xytext=(3, 5.5), arrowprops=dict(arrowstyle="->", color='#666666', lw=1.5), zorder=1)
    plt.text(3.1, 5.1, 'Consulta tracking\n(Lenguaje Natural)', color='#666666', ha='right', va='center', fontsize=8, rotation=-45)

    # Despachador -> Sistema
    ax.annotate('', xy=(3.5, 3.5), xytext=(3, 2.5), arrowprops=dict(arrowstyle="->", color='#666666', lw=1.5), zorder=1)
    plt.text(3.1, 2.9, 'Gestiona envíos\ny rutas', color='#666666', ha='right', va='center', fontsize=8, rotation=45)

    # Chofer -> Sistema
    ax.annotate('', xy=(6.5, 4.5), xytext=(7, 5.5), arrowprops=dict(arrowstyle="->", color='#666666', lw=1.5), zorder=1)
    plt.text(6.9, 5.1, 'Actualiza estados\nde entrega', color='#666666', ha='left', va='center', fontsize=8, rotation=45)

    # Sistema -> IA
    ax.add_patch(patches.Rectangle((7, 2), 2, 1, facecolor='#999999', edgecolor='#666666', lw=2, zorder=2))
    plt.text(8, 2.5, 'API de LLM\n[Sistema Externo]', color='white', ha='center', va='center', fontsize=10, fontweight='bold', zorder=3)
    ax.annotate('', xy=(7, 2.5), xytext=(6.5, 3.5), arrowprops=dict(arrowstyle="<->", color='#666666', lw=1.5), zorder=1)
    plt.text(6.9, 2.9, 'Procesa NLP', color='#666666', ha='left', va='center', fontsize=8, rotation=-45)

    plt.title("C4 Model - Context Diagram\nPlataforma Logística", fontsize=14, fontweight='bold', pad=20)
    plt.tight_layout()
    plt.savefig(filepath, dpi=300, bbox_inches='tight')
    plt.close()

if __name__ == "__main__":
    generate_c4_context()
    print("Diagrama C4 de Contexto generado.")
