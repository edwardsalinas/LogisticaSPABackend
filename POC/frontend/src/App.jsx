import React, { useState, useEffect } from 'react';

function App() {
    const [inventory, setInventory] = useState([]);
    const [chatMessage, setChatMessage] = useState('');
    const [chatHistory, setChatHistory] = useState([]);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        // Fetch mock inventory
        fetch('http://localhost:3001/api/logistics/inventory')
            .then(res => res.json())
            .then(data => setInventory(data.data || []))
            .catch(err => console.error("API Error:", err));
    }, []);

    const handleChat = async (e) => {
        e.preventDefault();
        if (!chatMessage.trim()) return;

        const userMsg = { role: 'user', content: chatMessage };
        setChatHistory(prev => [...prev, userMsg]);
        setChatMessage('');
        setLoading(true);

        try {
            const res = await fetch('http://localhost:3001/api/agent/query', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ message: chatMessage })
            });
            const data = await res.json();
            setChatHistory(prev => [...prev, { role: 'assistant', content: data.content }]);
        } catch (err) {
            setChatHistory(prev => [...prev, { role: 'assistant', content: "Error de conexión con el agente." }]);
        } finally {
            setLoading(false);
        }
    };

    return (
        <div className="min-h-screen bg-gray-100 flex flex-col">
            <header className="bg-blue-900 text-white p-4 shadow-md">
                <h1 className="text-2xl font-bold">Logistics AI Platform (POC)</h1>
                <p className="text-sm opacity-80">Arquitectura Monolito Modular: Node.js + React</p>
            </header>

            <main className="flex-1 p-6 flex gap-6 overflow-hidden">
                {/* Dashboard Panel */}
                <div className="flex-[2] bg-white rounded-lg shadow p-6 overflow-auto">
                    <h2 className="text-xl font-semibold mb-4 text-gray-800">Inventario en Tiempo Real (Supabase Mock)</h2>
                    <table className="w-full text-left border-collapse">
                        <thead>
                            <tr className="border-b bg-gray-50">
                                <th className="p-3">ID</th>
                                <th className="p-3">Producto</th>
                                <th className="p-3">Stock</th>
                                <th className="p-3">Ubicación</th>
                                <th className="p-3">Estado</th>
                            </tr>
                        </thead>
                        <tbody>
                            {inventory.map(item => (
                                <tr key={item.id} className="border-b hover:bg-gray-50">
                                    <td className="p-3">#{item.id}</td>
                                    <td className="p-3 font-medium">{item.name}</td>
                                    <td className="p-3">{item.stock}</td>
                                    <td className="p-3">{item.location}</td>
                                    <td className={`p-3 font-bold ${item.status === 'Low Stock' || item.status === 'Out of Stock' ? 'text-red-600' : 'text-green-600'}`}>
                                        {item.status}
                                    </td>
                                </tr>
                            ))}
                            {inventory.length === 0 && <tr><td colSpan="5" className="p-4 text-center">Cargando inventario...</td></tr>}
                        </tbody>
                    </table>
                </div>

                {/* Chat Agent Panel */}
                <div className="flex-1 bg-white rounded-lg shadow flex flex-col border border-gray-200">
                    <div className="bg-gray-50 p-4 border-b">
                        <h2 className="text-lg font-semibold text-gray-700">Agente Logístico AI</h2>
                    </div>
                    <div className="flex-1 p-4 overflow-y-auto space-y-4 max-h-[500px]">
                        {chatHistory.length === 0 && (
                            <p className="text-center text-gray-400 mt-10">Hola, soy tu asistente. Pregúntame sobre el stock o crea órdenes.</p>
                        )}
                        {chatHistory.map((msg, idx) => (
                            <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                                <div className={`max-w-[80%] rounded-lg p-3 ${msg.role === 'user' ? 'bg-blue-600 text-white' : 'bg-gray-200 text-gray-800'}`}>
                                    {msg.content}
                                </div>
                            </div>
                        ))}
                        {loading && <div className="text-gray-400 text-sm ml-2">Escribiendo...</div>}
                    </div>
                    <form onSubmit={handleChat} className="p-4 border-t flex gap-2">
                        <input
                            type="text"
                            className="flex-1 border border-gray-300 rounded px-3 py-2 focus:outline-none focus:ring-2 focus:ring-blue-500"
                            placeholder="Escribe tu consulta..."
                            value={chatMessage}
                            onChange={e => setChatMessage(e.target.value)}
                        />
                        <button type="submit" className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 transition">
                            Enviar
                        </button>
                    </form>
                </div>
            </main>
        </div>
    );
}

export default App;
