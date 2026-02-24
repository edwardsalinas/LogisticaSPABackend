from thesis_builder import ThesisDocument

def generate_sample():
    # Inicializar documento
    thesis = ThesisDocument("Generic_Thesis_Sample.docx")

    # Portada (Simulada)
    thesis.add_heading("TITULO DE LA TESIS GENÉRICA", level=1)
    thesis.add_paragraph("Autor: Juan Perez", align=1) # Center
    thesis.add_page_break()

    # Indices
    thesis.add_heading("ÍNDICE GENERAL", level=1)
    thesis.add_toc()
    thesis.add_page_break()

    thesis.add_heading("ÍNDICE DE FIGURAS", level=1)
    thesis.add_index_figures()
    thesis.add_heading("ÍNDICE DE TABLAS", level=1)
    thesis.add_index_tables()
    thesis.add_page_break()

    # Contenido
    thesis.add_heading("CAPÍTULO 1: INTRODUCCIÓN", level=1)
    thesis.add_heading("1.1 Antecedentes", level=2)
    thesis.add_paragraph("Este es un párrafo de ejemplo para demostrar la funcionalidad del script refactorizado. El estilo de fuente debe ser Arial 12pt.")
    
    thesis.add_heading("1.2 Planteamiento del Problema", level=2)
    thesis.add_paragraph("A continuación se muestra una tabla generada automáticamente:")

    # Tabla
    headers = ["ID", "Requerimiento", "Prioridad"]
    rows = [
        ["RF01", "El sistema debe generar documentos", "Alta"],
        ["RF02", "El sistema debe soportar tablas", "Media"],
        ["RF03", "El sistema debe soportar imágenes", "Baja"]
    ]
    thesis.add_table_with_data(headers, rows, caption="Lista de Requerimientos de Ejemplo")

    thesis.add_heading("CAPÍTULO 2: MARCO TEÓRICO", level=1)
    thesis.add_paragraph("Prueba de imágenes (placeholder solamente si no existe):")
    
    # Imagen (Usando el archivo si existe, sino placeholder)
    thesis.add_image("media/test_image.png", caption="Diagrama de Arquitectura Genérico")

    thesis.add_heading("CAPÍTULO 3: PRUEBAS", level=1)
    thesis.add_test_case(
        "TC01", 
        "Generación de Documento", 
        "Script configurado", 
        "1. Ejecutar script\n2. Abrir Word", 
        "Documento legible", 
        "PASÓ"
    )

    # Guardar
    thesis.save()

if __name__ == "__main__":
    generate_sample()
