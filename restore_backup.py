import json

log_path = '/home/rafaelg1004/.gemini/antigravity/brain/067632e3-fd86-46f3-aa60-f74e11ddc756/.system_generated/logs/overview.txt'

with open(log_path, 'r') as f:
    for line in f:
        try:
            data = json.loads(line)
            if data.get('type') == 'PLANNER_RESPONSE':
                for tool in data.get('tool_calls', []):
                    if tool.get('name') == 'view_file':
                        output = tool.get('response', {}).get('output', '')
                        if 'module.exports = {' in output and 'pagarCuota' in output:
                            # Print the raw text so we can see it
                            with open('/mnt/windows/Users/Mi PC/Documents/Proyectos/Prestamos/backend/extract.txt', 'w') as out:
                                out.write(output)
                            print("Extracted to extract.txt")
                            exit(0)
        except Exception as e:
            pass
            
print("Could not find backup.")
