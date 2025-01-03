ENV_DIR="env"
if [[ ! -d $ENV_DIR ]]; then
	python3 -m venv $ENV_DIR
	source $ENV_DIR/bin/activate
	python -m pip install -r requirements.txt
else
	source $ENV_DIR/bin/activate
	python -m pip install -r requirements.txt
fi