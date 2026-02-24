import matplotlib.pyplot as plt

def generate_ishikawa_diagram(filename="ishikawa_diagram.png"):
    # Datos del diagrama
    problem = "Deficiente Gestión\nLogística y Falta de\nVisibilidad en Tiempo Real"
    categories = {
        "Tecnología": ["Sistemas legados incompatibles", "Falta de análisis predictivo", "Falta de integración modular"],
        "Procesos": ["Flujos manuales y redundantes", "Aprobaciones lentas", "Registro de datos no estándar"],
        "Personas": ["Resistencia al cambio", "Errores humanos (entrada datos)", "Dependencia de TI para reportes"],
        "Información": ["Datos duplicados/inconsistentes", "Información desactualizada", "Difícil auditoría histórica"]
    }

    fig, ax = plt.subplots(figsize=(12, 8))
    
    # Configurar eje
    ax.set_xlim(0, 12)
    ax.set_ylim(0, 8)
    ax.axis('off')

    # Cabeza (Problema)
    bbox_props = dict(boxstyle="rarrow,pad=0.3", fc="salmon", ec="black", lw=2)
    ax.text(10, 4, problem, ha="center", va="center", size=12, weight='bold', bbox=bbox_props)

    # Espina dorsal
    ax.plot([0, 10], [4, 4], color='black', linewidth=3)

    # Costillas principales y sub-costillas
    # Coordenadas manualmente ajustadas para 4 categorías
    # Arriba: Tecnología (2), Procesos (6)
    # Abajo: Personas (2), Información (6)
    
    # Estructura: (x_pos, y_start, y_end, nombre, lista_causas, is_top)
    ribs = [
        (2, 4, 7, "Tecnología", categories["Tecnología"], True),
        (6, 4, 7, "Procesos", categories["Procesos"], True),
        (2, 4, 1, "Personas", categories["Personas"], False),
        (6, 4, 1, "Información", categories["Información"], False)
    ]

    for x_pos, y_start, y_end, name, causes, is_top in ribs:
        # Dibujar costilla
        ax.plot([x_pos, x_pos+1], [y_start, y_end], color='blue', linewidth=2)
        
        # Etiqueta de la categoría
        label_y = y_end + 0.2 if is_top else y_end - 0.2
        ax.text(x_pos+1, label_y, name, ha='center', va='center', size=11, weight='bold', 
                bbox=dict(boxstyle="round,pad=0.3", fc="lightblue", ec="black"))

        # Dibujar causas
        num_causes = len(causes)
        # Distribuir causas a lo largo de la costilla
        # La costilla va de (x_pos, 4) a (x_pos+1, y_end)
        # Interpolamos posiciones
        for i, cause in enumerate(causes):
            # Fracción del camino (de 0.2 a 0.8 para no pegar a los extremos)
            frac = 0.2 + (i * (0.6 / max(num_causes - 1, 1)))
            
            # Coordenadas en la línea de la costilla
            cx = x_pos + frac * 1
            cy = 4 + frac * (y_end - 4)
            
            # Línea de la causa (horizontal pequeña)
            direction = 1 if is_top else -1 # No usado para dirección X, siempre derecha para texto
            # Dibujar linea horizontal pequeña hacia la derecha
            ax.plot([cx, cx + 0.5], [cy, cy], color='gray', linewidth=1)
            
            # Texto de la causa
            ax.text(cx + 0.6, cy, cause, ha='left', va='center', size=9, wrap=True)

    plt.tight_layout()
    plt.savefig(filename, dpi=300)
    print(f"Diagrama guardado como {filename}")
    plt.close()

if __name__ == "__main__":
    generate_ishikawa_diagram()
