// js/api.js

export async function detectGlassesAPI(file) {
  const formData = new FormData();
  formData.append("file", file);

  try {
    const response = await fetch("http://localhost:8000/detect-glasses", {
      method: "POST",
      body: formData,
    });

    const data = await response.json();
    return data;

  } catch (error) {
    return {
      success: false,
      error: error.message
    };
  }
}
