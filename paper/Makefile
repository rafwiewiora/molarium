.PHONY: pdf watch clean

pdf:
	latexmk -r latexmkrc main.tex

watch:
	latexmk -r latexmkrc -pvc main.tex

clean:
	latexmk -r latexmkrc -C main.tex
